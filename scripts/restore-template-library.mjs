// Local-only library restoration. This script never calls any model service.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {loadLocalEnv} from '../backend/model.mjs';
import {openRepository} from '../backend/database.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const arg=process.argv.slice(2),execute=arg.includes('--execute');
if(arg.some(a=>a!=='--execute'))throw new Error('用法：npm run restore:library，确认后 npm run restore:library -- --execute');
const library=path.resolve(root,'..','模板库数据');
const raw=await fs.readFile(path.join(library,'模板库快照.json'));
const sha=b=>createHash('sha256').update(b).digest('hex');
const hash=sha(raw),data=JSON.parse(raw.toString('utf8'));
if(data.schemaVersion!=='tx-template-library-v1'||data.scope!=='templates-and-knowledge-only')throw new Error('不支持的模板库快照');
for(const k of ['resources','documents','texts','chunks','files'])if(!Array.isArray(data[k]))throw new Error('快照缺少有效的 '+k);
const ids=new Set(data.documents.map(d=>d.id));
if(ids.size!==data.documents.length||data.documents.some(d=>typeof d.id!=='string'||!d.id.startsWith('DOC-')))throw new Error('资料编号无效或重复');
const files=new Map();
for(const f of data.files){
 if(!ids.has(f.document_id)||files.has(f.document_id)||typeof f.file!=='string')throw new Error('原件引用无效');
 const name=path.resolve(library,f.file);
 if(!name.startsWith(library+path.sep)||(await fs.lstat(name)).isSymbolicLink())throw new Error('原件路径无效');
 const bytes=await fs.readFile(name);
 if(bytes.length!==f.bytes||sha(bytes)!==f.sha256)throw new Error('原件校验失败：'+f.file);
 files.set(f.document_id,{...f,content:bytes});
}
const chunkIds=new Set(),textIds=new Set();
for(const t of data.texts){if(!ids.has(t.document_id)||textIds.has(t.document_id))throw new Error('原文引用无效');textIds.add(t.document_id);}
for(const c of data.chunks){
 if(!ids.has(c.document_id)||chunkIds.has(c.id)||!Number.isInteger(c.dimensions)||!Array.isArray(c.embedding)||c.embedding.length!==c.dimensions||c.embedding.some(x=>typeof x!=='number'||!Number.isFinite(x)))throw new Error('向量片段无效');
 chunkIds.add(c.id);
}
if(data.resources.some(r=>!['letters','rag-settings'].includes(r.id))||new Set(data.resources.map(r=>r.id)).size!==data.resources.length)throw new Error('模板资源范围无效');
const templates=data.resources.find(r=>r.id==='letters')?.payload?.templates;
if(!Array.isArray(templates)||templates.length!==data.counts.templates||data.documents.length!==data.counts.documents||data.chunks.length!==data.counts.chunks||data.files.length!==data.counts.originals)throw new Error('快照数量不一致');
const summary={templates:templates.length,documents:data.documents.length,originals:data.files.length,chunks:data.chunks.length,originalsVerified:true,snapshotSha256:hash,externalModelCalls:0};
await loadLocalEnv(root);
if(!process.env.TX_DATABASE_URL){
 if(execute)throw new Error('请先按教程填写 .env.local 的 TX_DATABASE_URL');
 console.log(JSON.stringify({...summary,mode:'preview',databaseConfigured:false,note:'先配置数据库，再执行 --execute 恢复'},null,2));
 process.exit(0);
}
const state=process.env.TX_DATA_DIR||path.join(root,'.local-data');
await fs.mkdir(state,{recursive:true});
const repository=await openRepository(state,process.env.TX_DATABASE_URL);
try{
 const pool=repository.pool;
 const old=(await pool.query("SELECT payload FROM tx_meta WHERE key='library-package-import-v1'")).rows[0]?.payload;
 if(old?.snapshotSha256===hash){
  const counts=await pool.query('SELECT (SELECT count(*)::int FROM tx_documents) AS documents,(SELECT count(*)::int FROM tx_document_files) AS originals,(SELECT count(*)::int FROM tx_chunks) AS chunks');
  console.log(JSON.stringify({...summary,mode:execute?'execute':'preview',alreadyRestored:true,reused:true,currentCounts:counts.rows[0]},null,2));
 }else{
  const check=async q=>(await q.query('SELECT (SELECT count(*)::int FROM tx_documents) AS documents,(SELECT count(*)::int FROM tx_chunks) AS chunks,(SELECT count(*)::int FROM tx_projects) AS projects,(SELECT count(*)::int FROM tx_tasks) AS tasks')).rows[0];
  const before=await check(pool);
  const empty=Object.values(before).every(n=>n===0);
  if(!execute){console.log(JSON.stringify({...summary,mode:'preview',databaseConfigured:true,targetCounts:before,canRestore:empty,note:empty?'停止前后端后，添加 --execute 执行本机恢复':'目标库已有资料或任务，请使用新空库，不会覆盖'},null,2));}
  else{
   if(!empty)throw new Error('目标数据库已有工程、任务或知识资料；为避免覆盖，请使用新空库恢复。');
   const c=await pool.connect();
   try{
    await c.query('BEGIN');
    await c.query("SELECT pg_advisory_xact_lock(hashtext('tx-template-library-restore'))");
    if(Object.values(await check(c)).some(n=>n!==0))throw new Error('目标库已变化，停止恢复');
    for(const r of data.resources)await c.query('INSERT INTO tx_resources(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload',[r.id,JSON.stringify(r.payload)]);
    for(const d of data.documents)await c.query('INSERT INTO tx_documents(id,title,kind,consultation_type,project_id,project_version,enabled,content_hash,metadata,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',[d.id,d.title,d.kind,d.consultation_type,d.project_id,d.project_version,d.enabled,d.content_hash,JSON.stringify(d.metadata),d.created_at]);
    for(const t of data.texts)await c.query('INSERT INTO tx_document_text(document_id,content,index_text) VALUES($1,$2,$3)',[t.document_id,t.content,t.index_text]);
    for(const f of files.values())await c.query('INSERT INTO tx_document_files(document_id,name,content) VALUES($1,$2,$3)',[f.document_id,f.name,f.content]);
    for(const v of data.chunks)await c.query('INSERT INTO tx_chunks(id,document_id,ordinal,content,embedding,embedding_model,dimensions) VALUES($1,$2,$3,$4,$5::vector,$6,$7)',[v.id,v.document_id,v.ordinal,v.content,JSON.stringify(v.embedding),v.embedding_model,v.dimensions]);
    const after=(await c.query('SELECT (SELECT count(*)::int FROM tx_documents) AS documents,(SELECT count(*)::int FROM tx_document_text) AS texts,(SELECT count(*)::int FROM tx_document_files) AS originals,(SELECT count(*)::int FROM tx_chunks) AS chunks')).rows[0];
    if(after.documents!==data.documents.length||after.texts!==data.texts.length||after.originals!==data.files.length||after.chunks!==data.chunks.length)throw new Error('恢复后数量不一致，将回滚');
    await c.query("INSERT INTO tx_meta(key,payload) VALUES('library-package-import-v1',$1) ON CONFLICT(key) DO UPDATE SET payload=EXCLUDED.payload",[JSON.stringify({snapshotSha256:hash,restoredAt:new Date().toISOString(),counts:after})]);
    await c.query('COMMIT');console.log(JSON.stringify({...summary,mode:'execute',restored:true,counts:after},null,2));
   }catch(e){await c.query('ROLLBACK').catch(()=>{});throw e;}finally{c.release();}
  }
 }
}finally{await repository.close();}
