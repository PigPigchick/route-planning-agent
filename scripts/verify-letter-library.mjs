import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import pg from 'pg';
import {loadLocalEnv} from '../backend/model.mjs';
import {LETTER_TEMPLATES} from '../dist/letters-core.mjs';
const root=process.cwd(),base='http://127.0.0.1:4318';await loadLocalEnv(root);
const client=new pg.Client({connectionString:process.env.TX_DATABASE_URL});await client.connect();
const api=async(p,b)=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:b?{'Content-Type':'application/json'}:undefined,body:b?JSON.stringify(b):undefined});assert.ok(r.ok,'API请求失败 '+p);return r.json();};
try{
 const records=(await client.query("SELECT d.id,d.metadata,t.content,t.index_text,f.name,f.content AS original FROM tx_documents d JOIN tx_document_text t ON t.document_id=d.id JOIN tx_document_files f ON f.document_id=d.id WHERE d.metadata->>'batch'='letter-library-2026-10-31'")).rows;
 assert.equal(records.length,109);
 for(const r of records){assert.ok(r.content.length>=30);assert.ok(!r.content.includes('\ufffd'));assert.equal(createHash('sha256').update(r.original).digest('hex'),r.metadata.fileHash);}
 const samples=[];
 for(const ext of ['.docx','.doc','.pdf','.jpg']){const r=records.find(r=>r.name.toLowerCase().endsWith(ext));if(!r)continue;const response=await fetch(base+'/api/v1/knowledge/'+r.id+'/original');assert.ok(response.ok);assert.deepEqual(Buffer.from(await response.arrayBuffer()),r.original);samples.push({name:r.name,bytes:r.original.length,sha256:r.metadata.fileHash});}
 const templates=[];
 for(const t of LETTER_TEMPLATES){const r=await api('/api/v1/knowledge',{action:'search',query:t.name+' 征询意见、资料要求与后续办理程序',type:t.id});assert.ok(r.sources.length,'没有检索到对应模板 '+t.id);assert.ok(r.sources.every(s=>s.metadata.direction!=='incoming'));templates.push({type:t.id,name:t.name,hit:r.sources[0].title,score:r.sources[0].score});}
 const tasks=await api('/api/v1/tasks'),qa=tasks.tasks.find(t=>t.projectId==='RAG-VERIFY-20261030');assert.ok(qa&&qa.result.letters[0].retrieval.sources.length);
 const report={at:new Date().toISOString(),database:await api('/api/v1/storage'),archive:{documents:records.length,originalBytes:records.reduce((n,r)=>n+r.original.length,0),allOriginalHashesMatch:true,noReplacementCharacters:true,downloadSamples:samples},templates,taskHistory:{count:tasks.tasks.length,qaTaskId:qa.id,status:qa.result.letters[0].status,references:qa.result.letters[0].retrieval.sources.length}};
 await fs.writeFile(path.join(root,'outputs/函件资料入库_2026-10-31/端到端验证记录.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({archive:report.archive.documents,originalBytes:report.archive.originalBytes,downloads:samples.length,templateTypes:templates.length,qaStatus:report.taskHistory.status,historyTasks:report.taskHistory.count}));
}finally{await client.end();}
