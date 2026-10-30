import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import pg from 'pg';

const groups={contexts:'tx_contexts',tasks:'tx_tasks',assets:'tx_assets',files:'tx_exports'};
const fingerprint=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function openRepository(stateDir,url=process.env.TX_DATABASE_URL){
 const stateFile=path.join(stateDir,'records.json');
 if(!url){
  let initial={};try{initial=JSON.parse(await fs.readFile(stateFile,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e;}
  return {engine:'json',initial,pool:null,async save(db){await fs.writeFile(stateFile+'.tmp',JSON.stringify(db),{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile)},async close(){}};
 }
 const pool=new pg.Pool({connectionString:url,max:5,connectionTimeoutMillis:5000,idleTimeoutMillis:10000});
 pool.on('error',()=>console.error('数据库连接中断，请检查本机 PostgreSQL 服务'));
 try{
  await pool.query(`CREATE EXTENSION IF NOT EXISTS vector;
   CREATE TABLE IF NOT EXISTS tx_meta (key text PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_contexts (id text PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_tasks (id text PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_assets (id text PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_exports (id text PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_resources (id text PRIMARY KEY,payload jsonb NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_projects (id text PRIMARY KEY,revision integer NOT NULL DEFAULT 1,payload jsonb NOT NULL,updated_at timestamptz NOT NULL DEFAULT now());
   CREATE INDEX IF NOT EXISTS tx_tasks_project ON tx_tasks ((payload->>'projectId'),(payload->>'projectVersion'));
   CREATE TABLE IF NOT EXISTS tx_documents (id text PRIMARY KEY,title text NOT NULL,kind text NOT NULL,consultation_type text NOT NULL,project_id text NOT NULL DEFAULT '',project_version text NOT NULL DEFAULT '',enabled boolean NOT NULL DEFAULT true,content_hash text NOT NULL,metadata jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
   CREATE TABLE IF NOT EXISTS tx_chunks (id text PRIMARY KEY,document_id text NOT NULL REFERENCES tx_documents(id),ordinal integer NOT NULL,content text NOT NULL,embedding vector NOT NULL,embedding_model text NOT NULL,dimensions integer NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_document_text (document_id text PRIMARY KEY REFERENCES tx_documents(id),content text NOT NULL,index_text text NOT NULL);
   CREATE TABLE IF NOT EXISTS tx_document_files (document_id text PRIMARY KEY REFERENCES tx_documents(id),name text NOT NULL,content bytea NOT NULL);
   CREATE INDEX IF NOT EXISTS tx_chunks_document ON tx_chunks(document_id);
   CREATE INDEX IF NOT EXISTS tx_documents_filters ON tx_documents(enabled,consultation_type,project_id,project_version);`);
  const marker=await pool.query("SELECT 1 FROM tx_meta WHERE key='json-migration-v1'");
  if(!marker.rowCount){
   let legacy={};try{legacy=JSON.parse(await fs.readFile(stateFile,'utf8'));await fs.copyFile(stateFile,path.join(stateDir,'records.pre-postgres-'+Date.now()+'.json'));}catch(e){if(e.code!=='ENOENT')throw e;}
   const c=await pool.connect();try{await c.query('BEGIN');
    for(const [group,table] of Object.entries(groups))for(const [id,value] of Object.entries(legacy[group]||{}))await c.query(`INSERT INTO ${table}(id,payload) VALUES($1,$2) ON CONFLICT DO NOTHING`,[id,JSON.stringify(value)]);
    if(legacy.letterResources)await c.query("INSERT INTO tx_resources(id,payload) VALUES('letters',$1) ON CONFLICT DO NOTHING",[JSON.stringify(legacy.letterResources)]);
    await c.query("INSERT INTO tx_meta(key,payload) VALUES('json-migration-v1',$1) ON CONFLICT DO NOTHING",[JSON.stringify({at:new Date().toISOString(),counts:Object.fromEntries(Object.keys(groups).map(k=>[k,Object.keys(legacy[k]||{}).length]))})]);
    await c.query('COMMIT');
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  }
  const initial={},hashes=new Map();
  for(const [group,table] of Object.entries(groups)){
   initial[group]={};for(const {id,payload} of (await pool.query(`SELECT id,payload FROM ${table}`)).rows){initial[group][id]=payload;hashes.set(table+':'+id,fingerprint(payload));}
  }
  const resource=(await pool.query("SELECT payload FROM tx_resources WHERE id='letters'")).rows[0]?.payload;
  if(resource){initial.letterResources=resource;hashes.set('tx_resources:letters',fingerprint(resource));}
  return {engine:'postgresql',initial,pool,async save(db){
   const changes=[];
   for(const [group,table] of Object.entries(groups))for(const [id,value] of Object.entries(db[group]||{})){const hash=fingerprint(value);if(hashes.get(table+':'+id)!==hash)changes.push({table,id,value,hash});}
   if(db.letterResources){const hash=fingerprint(db.letterResources);if(hashes.get('tx_resources:letters')!==hash)changes.push({table:'tx_resources',id:'letters',value:db.letterResources,hash});}
   if(!changes.length)return;
   const c=await pool.connect();try{await c.query('BEGIN');for(const x of changes)await c.query(`INSERT INTO ${x.table}(id,payload) VALUES($1,$2) ON CONFLICT(id) ${x.table==='tx_contexts'?'DO NOTHING':'DO UPDATE SET payload=EXCLUDED.payload'}`,[x.id,JSON.stringify(x.value)]);await c.query('COMMIT');for(const x of changes)hashes.set(x.table+':'+x.id,x.hash);}catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  },async close(){await pool.end();}};
 }catch(e){await pool.end();throw new Error('PostgreSQL 初始化失败：'+e.message);}
}

export async function databaseStatus(repository){
 if(!repository.pool)return {engine:'json',connected:true,vector:false};
 const r=await repository.pool.query("SELECT version(),(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector");
 return {engine:'postgresql',connected:true,vector:!!r.rows[0].vector,vectorVersion:r.rows[0].vector};
}
