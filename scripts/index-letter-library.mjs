import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRepository} from '../backend/database.mjs';
import {loadLocalEnv,modelStore} from '../backend/model.mjs';
import {knowledgeStore} from '../backend/knowledge.mjs';
import {historicalIndexText} from '../backend/letter-library.mjs';
import {splitKnowledge} from '../backend/knowledge-text.mjs';

// User explicitly approved this batch's outgoing redacted text for the configured
// Qwen service on 2026-10-31. Incoming replies/supporting files are never indexed.
const root=path.dirname(path.dirname(fileURLToPath(import.meta.url))),execute=process.argv.includes('--execute');
await loadLocalEnv(root);
if(!process.env.TX_DATABASE_URL)throw new Error('请先配置PostgreSQL');
const repository=await openRepository(path.join(root,'.local-data')),model=await modelStore(path.join(root,'.local-data')),knowledge=await knowledgeStore(repository,model);
const out=path.join(root,'outputs/函件资料入库_2026-10-31');await fs.mkdir(out,{recursive:true});
try{
 const cfg=knowledge.settings(),destination=new URL(cfg.baseUrl);
 if(destination.protocol!=='https:'||destination.hostname!=='cn-beijing.maas.qianwenaiapi.com')throw new Error('当前服务与本次授权的千问地址不同，请先核对配置');
 const docs=(await repository.pool.query("SELECT d.id,d.title,d.consultation_type,d.metadata,t.content,t.index_text FROM tx_documents d JOIN tx_document_text t ON t.document_id=d.id WHERE d.metadata->>'batch'='letter-library-2026-10-31' AND d.metadata->>'direction'='outgoing' ORDER BY d.id")).rows;
 if(docs.length!==45)throw new Error('发函数量与已授权的45份不一致，停止本次批量操作');
 const checks=docs.map(d=>{
  const text=historicalIndexText(d.content);
  const contactPattern=/联系人|收件人|地址[:：]|联系电话|联系手机|邮编|传真|(?:\+?86[- ]?)?1[3-9]\d{9}|0\d{2,3}[-— ]?\d{7,8}|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|sk-[A-Za-z0-9_-]{12}/;
  return {id:d.id,title:d.title,type:d.consultation_type,characters:text.length,chunks:splitKnowledge(text).length,sameAsSaved:text===d.index_text,contactDetected:contactPattern.test(text),extractionError:d.metadata.extractionError||''};
 });
 const preflight={at:new Date().toISOString(),destination:cfg.baseUrl,model:cfg.model,dimensions:cfg.dimensions,documents:docs.length,chunks:checks.reduce((n,d)=>n+d.chunks,0),characters:checks.reduce((n,d)=>n+d.characters,0),checks};
 await fs.writeFile(path.join(out,'历史发函向量化预检.json'),JSON.stringify(preflight,null,2));
 if(checks.some(d=>d.contactDetected||!d.sameAsSaved||d.extractionError))throw new Error('预检未通过，请查看本机预检记录；尚未发送任何正文');
 console.log(JSON.stringify({stage:'preflight',documents:preflight.documents,chunks:preflight.chunks,characters:preflight.characters,contactDetected:false,model:cfg.model,dimensions:cfg.dimensions,execute}));
 if(execute){
  const results=[];
  for(const doc of docs){
   try{const r=await knowledge.indexDocument(doc.id);results.push({id:doc.id,title:doc.title,type:doc.consultation_type,...r,ok:true});}
   catch(e){results.push({id:doc.id,title:doc.title,type:doc.consultation_type,ok:false,error:e.message});}
   await fs.writeFile(path.join(out,'历史发函向量化结果.json'),JSON.stringify(results,null,2));
   console.log(JSON.stringify({progress:results.length,total:docs.length,ok:results.at(-1).ok,chunks:results.at(-1).chunks||0}));
  }
  const summary={at:new Date().toISOString(),destination:cfg.baseUrl,model:cfg.model,dimensions:cfg.dimensions,documents:docs.length,indexed:results.filter(r=>r.ok).length,chunks:results.reduce((n,r)=>n+(r.chunks||0),0),failures:results.filter(r=>!r.ok)};
  await fs.writeFile(path.join(out,'历史发函向量化汇总.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
  if(summary.failures.length)process.exitCode=1;
 }
}finally{await repository.close();}
