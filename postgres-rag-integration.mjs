import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import http from 'node:http';
import {spawn} from 'node:child_process';
import pg from 'pg';
import {loadLocalEnv} from './backend/model.mjs';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {letterContext} from './dist/letter-table.mjs';
import {openRepository} from './backend/database.mjs';
import {knowledgeStore} from './backend/knowledge.mjs';

await loadLocalEnv(process.cwd());if(!process.env.TX_DATABASE_URL)throw new Error('请先配置PostgreSQL');
const name='tx_rag_qa_'+process.pid,dbUrl=new URL(process.env.TX_DATABASE_URL),adminUrl=new URL(dbUrl);adminUrl.pathname='/postgres';dbUrl.pathname='/'+name;
const admin=new pg.Client({connectionString:adminUrl.toString()});await admin.connect();await admin.query('CREATE DATABASE "'+name+'"');
const dir=await fs.mkdtemp(path.join(os.tmpdir(),'tx-pg-rag-')),origin='http://127.0.0.1:4340';let child,logs='',embeddings=0,generations=0;
const mock=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);res.writeHead(200,{'Content-Type':'application/json'});
 if(req.url==='/v1/embeddings'){embeddings++;const input=Array.isArray(b.input)?b.input:[b.input];const data=input.map((text,index)=>{const embedding=Array.from({length:b.dimensions||1024},()=>0);embedding[0]=1;embedding[/公路|高速/.test(text)?1:/河道|航道/.test(text)?2:3]=1;return {object:'embedding',index,embedding};});res.end(JSON.stringify({object:'list',model:b.model,data,usage:{prompt_tokens:10,total_tokens:10}}));}
 else{generations++;const metadata=JSON.parse(b.messages[1].content);assert.ok(metadata.retrievedReferences?.length);res.end(JSON.stringify({model:b.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify({bodyBlocks:['{{projectOverview}}','{{routeSummary}}','{{requestItems}}','请研究后函复有关意见。']})}}],usage:{total_tokens:20}}));}
 }catch(e){res.statusCode=500;res.end(JSON.stringify({error:{message:e.message}}));}});
async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4340',TX_DATA_DIR:dir,TX_DATABASE_URL:dbUrl.toString(),TX_USE_DATABASE:'true',LLM_MODEL:'',LLM_API_KEY:''},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>c&&j(new Error(logs)))});}
async function stop(){if(child){const p=child;child=null;await new Promise(r=>{p.once('exit',r);p.kill()});}}
async function api(p,body,expected=200){const response=await fetch(origin+p,{method:body?'POST':'GET',headers:body?{'Content-Type':'application/json'}:undefined,body:body?JSON.stringify(body):undefined});const value=await response.json();assert.equal(response.status,expected,JSON.stringify(value));return value;}
let database;
try{
 await fs.writeFile(path.join(dir,'records.json'),JSON.stringify({contexts:{legacy:{id:'legacy',context:SAMPLE}},tasks:{},assets:{},files:{}}));
 await new Promise(r=>mock.listen(4341,'127.0.0.1',r));await start();
 const status=await api('/api/v1/storage');assert.equal(status.engine,'postgresql');assert.equal(status.vector,true);
 database=new pg.Client({connectionString:dbUrl.toString()});await database.connect();assert.equal((await database.query("SELECT payload FROM tx_contexts WHERE id='legacy'")).rowCount,1);assert.ok((await fs.readdir(dir)).some(n=>n.startsWith('records.pre-postgres-')));
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);input.project.id='PG-QA';input.agreements=input.agreements.slice(0,1);input.templateConfirmed=true;
 Object.assign(input.project,{issuer:'虚构测试单位',contactName:'虚构联系人',contactPhone:'虚构电话',replyAddress:'虚构地址',issueDate:'2026-10-30'});
 const context=letterContext(input),key=JSON.stringify([input.project.id,input.project.version]),record={entry:{key,context,routeId:input.route.id,selected:[input.route.id]},workingCopies:{A:{input,selected:[]}}};
 const saved=await api('/api/v1/projects',record);assert.equal(saved.revision,1);assert.equal((await api('/api/v1/projects')).records[0].workingCopies.A.input.project.id,'PG-QA');
 await api('/api/v1/projects',record,409);const next=structuredClone(record);next.workingCopies.A.input.project.overview='修改后仍保留的工程概况';await api('/api/v1/projects',{...next,expectedRevision:1});
 await api('/api/v1/model-config',{baseUrl:'http://127.0.0.1:4341/v1',model:'test-llm',apiKey:'synthetic-rag-key',jsonMode:true,stream:false,thinkingMode:'off'});
 await api('/api/v1/knowledge',{action:'configure',enabled:true});await api('/api/v1/knowledge',{action:'test'});
 const synced=await api('/api/v1/knowledge',{action:'sync-templates'});assert.equal(synced.documents,9);const countBefore=embeddings;await api('/api/v1/knowledge',{action:'sync-templates'});assert.equal(embeddings,countBefore);
 const other=await api('/api/v1/knowledge',{action:'ingest',title:'其他工程专用资料',type:'general',projectId:'OTHER',projectVersion:'v1',text:'仅适用于其他工程的专用林业征询内容，不应用到当前测试工程。'});
 const history=await api('/api/v1/knowledge',{action:'ingest',title:'通用行文参考',kind:'history',type:'general',text:'线路路径方案征询意见。请结合职责研究后续办理要求，并书面函复有关意见。'});
 const local=await openRepository(dir,dbUrl.toString());
 try{
  const library=await knowledgeStore(local,{get:()=>({baseUrl:'http://127.0.0.1:4341/v1',apiKey:'synthetic-rag-key'})});
  const before=embeddings,original=Buffer.from('仅供测试的原始Word字节'),args={title:'本机发函原件测试',type:'general',direction:'outgoing',text:'原始文字包含联系人测试甲。工程路径方案征询意见。',indexText:'工程路径方案征询意见，请就管理要求书面函复。',original:{name:'中文原件.docx',content:original},metadata:{source:'本机测试/中文原件.docx'}};
  const archive=await library.archive(args);assert.equal(embeddings,before,'仅归档不得调用外部向量服务');assert.equal((await library.archive(args)).reused,true);
  assert.equal((await api('/api/v1/knowledge',{action:'detail',id:archive.id})).enabled,false);
  const file=await fetch(origin+'/api/v1/knowledge/'+archive.id+'/original');assert.equal(file.status,200);assert.deepEqual(Buffer.from(await file.arrayBuffer()),original);
  await api('/api/v1/knowledge',{action:'set-enabled',id:archive.id,enabled:true},400);
  const indexed=await api('/api/v1/knowledge',{action:'index',id:archive.id});assert.equal(indexed.chunks,1);
  const indexedBefore=embeddings;assert.equal((await api('/api/v1/knowledge',{action:'index',id:archive.id})).reused,true);assert.equal(embeddings,indexedBefore);
  assert.equal((await library.archive({...args,text:args.text+' 补全原文',indexText:args.indexText+' 补全要点'})).id,archive.id);assert.equal(embeddings,indexedBefore);
  const updated=await api('/api/v1/knowledge',{action:'detail',id:archive.id});assert.equal(updated.enabled,false);assert.match(updated.content,/补全原文/);assert.equal((await database.query('SELECT id FROM tx_chunks WHERE document_id=$1',[archive.id])).rowCount,0);
  await api('/api/v1/knowledge',{action:'index',id:archive.id});
  const reply=await api('/api/v1/knowledge',{action:'ingest',title:'复函仅用于历史核对',kind:'history',type:'general',metadata:{direction:'incoming'},text:'历史复函已经同意该工程建设。此条不得作为新工程审批事实。'});
  const draftSources=await api('/api/v1/knowledge',{action:'search',query:'线路路径方案征询意见',type:'general',forDraft:true});assert.ok(draftSources.sources.every(s=>s.document_id!==reply.id));
 }finally{await local.close();}
 const search=await api('/api/v1/knowledge',{action:'search',query:'线路路径方案征询意见',type:'general',projectId:input.project.id,projectVersion:input.project.version});assert.ok(search.sources.some(s=>s.document_id===history.id));assert.ok(search.sources.every(s=>s.document_id!==other.id));
 await api('/api/v1/knowledge',{action:'set-enabled',id:history.id,enabled:false});assert.ok((await api('/api/v1/knowledge',{action:'search',query:'线路路径方案征询意见',type:'general'})).sources.every(s=>s.document_id!==history.id));
 await api('/api/v1/knowledge',{action:'set-enabled',id:history.id,enabled:true});
 const ctx=await api('/api/v1/context',context,201);let task=await api('/api/v1/tasks',{contextId:ctx.contextId,agentType:'letters',routeIds:['A'],options:{mode:'llm',lettersInput:input}},201);
 for(let n=0;n<100&&task.status==='running';n++){await new Promise(r=>setTimeout(r,50));task=await api('/api/v1/tasks/'+task.id,{action:'status'});}
 assert.equal(task.status,'awaiting_confirmation');assert.equal(task.result.letters[0].retrieval.status,'used');assert.ok(task.result.letters[0].retrieval.sources.length);assert.equal(generations,1);
 assert.equal((await database.query('SELECT payload FROM tx_tasks WHERE id=$1',[task.id])).rows[0].payload.result.letters[0].retrieval.status,'used');
 await stop();await start();assert.equal((await api('/api/v1/projects')).records[0].workingCopies.A.input.project.overview,'修改后仍保留的工程概况');assert.equal((await api('/api/v1/tasks/'+task.id,{action:'status'})).result.letters[0].retrieval.status,'used');assert.ok((await api('/api/v1/knowledge')).documents.length>=11);
 await api('/api/v1/projects',{action:'reset',key,expectedRevision:2});assert.equal((await api('/api/v1/projects')).records[0].hidden,true);assert.equal((await api('/api/v1/tasks')).tasks.length,1);
 const records=(await database.query('SELECT payload::text FROM tx_tasks')).rows.map(r=>r.payload).join('');assert.ok(!records.includes('synthetic-rag-key'));
 console.log('PostgreSQL＋pgvector联调通过：JSON备份迁移、工程保存与恢复、并发版本保护、模板向量化去重、工程范围过滤、停用资料过滤、RAG起草和引用记录、数据库重启恢复、重置保留历史。');
}finally{await stop();await new Promise(r=>mock.close(r));if(database)await database.end();await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');await admin.end();await fs.rm(dir,{recursive:true,force:true});}
