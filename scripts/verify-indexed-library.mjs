import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import pg from 'pg';
import {loadLocalEnv} from '../backend/model.mjs';
import {LETTER_TEMPLATES} from '../dist/letters-core.mjs';
await loadLocalEnv(process.cwd());
const db=new pg.Client({connectionString:process.env.TX_DATABASE_URL});await db.connect();
const api=async b=>{const r=await fetch('http://127.0.0.1:4318/api/v1/knowledge',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const v=await r.json();assert.ok(r.ok,v.error?.message);return v;};
try{
 const rows=(await db.query("SELECT d.id,d.enabled,d.metadata->>'direction' AS direction,count(c.id)::int AS chunks,min(vector_dims(c.embedding)) AS min_dimensions,max(vector_dims(c.embedding)) AS max_dimensions FROM tx_documents d LEFT JOIN tx_chunks c ON c.document_id=d.id WHERE d.metadata->>'batch'='letter-library-2026-10-31' GROUP BY d.id")).rows;
 const outgoing=rows.filter(r=>r.direction==='outgoing');assert.equal(outgoing.length,45);assert.equal(outgoing.reduce((n,r)=>n+r.chunks,0),59);assert.ok(outgoing.every(r=>r.enabled&&r.chunks&&r.min_dimensions===1024&&r.max_dimensions===1024));
 assert.ok(rows.filter(r=>r.direction!=='outgoing').every(r=>!r.chunks&&!r.enabled));
 const queries=[];
 for(const t of LETTER_TEMPLATES){
  const r=await api({action:'search',query:t.name+' 路径方案意见、管理要求和后续办理程序',type:t.id,forDraft:true});
  assert.equal(r.status,'used');assert.ok(r.sources.some(s=>s.kind==='history'),'未命中历史发函 '+t.id);assert.ok(r.sources.every(s=>!s.metadata.direction||s.metadata.direction==='outgoing'));
  queries.push({type:t.id,name:t.name,sources:r.sources.map(s=>({id:s.id,documentId:s.document_id,title:s.title,kind:s.kind,score:s.score}))});
 }
 const all=(await db.query('SELECT count(DISTINCT document_id)::int AS documents,count(*)::int AS chunks FROM tx_chunks')).rows[0];
 const report={at:new Date().toISOString(),outgoingDocuments:outgoing.length,outgoingChunks:59,totalIndexedDocuments:all.documents,totalChunks:all.chunks,dimensions:1024,incomingAndSupportOnlyLocal:true,queries};
 await fs.writeFile('outputs/函件资料入库_2026-10-31/历史发函检索验证.json',JSON.stringify(report,null,2));console.log(JSON.stringify({documents:all.documents,chunks:all.chunks,typesVerified:queries.length,historicalDocuments:45,incomingIndexed:0}));
}finally{await db.end();}
