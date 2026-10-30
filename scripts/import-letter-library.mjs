import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRepository} from '../backend/database.mjs';
import {loadLocalEnv,modelStore} from '../backend/model.mjs';
import {knowledgeStore} from '../backend/knowledge.mjs';
import {historicalIndexText,archiveLabel} from '../backend/letter-library.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));await loadLocalEnv(root);
if(!process.env.TX_DATABASE_URL)throw new Error('请先配置PostgreSQL');
const repository=await openRepository(path.join(root,'.local-data')),model=await modelStore(path.join(root,'.local-data')),knowledge=await knowledgeStore(repository,model);
const out=path.join(root,'outputs/函件资料入库_2026-10-31');await fs.mkdir(out,{recursive:true});
// This command ONLY archives locally. It never calls indexDocument/embeddings.
const results=[];
try{
 const records=JSON.parse(await fs.readFile(path.join(root,'.local-data/letter-library-2026-10-31/extracted.json'),'utf8'));
 for(const r of records){
  const result=await knowledge.archive({title:(archiveLabel(r.direction)+' · '+r.name).slice(0,200),type:r.type,direction:r.direction,text:r.text,indexText:r.direction==='outgoing'?historicalIndexText(r.text):'',original:{name:r.name,content:await fs.readFile(r.path)},metadata:{source:r.source,sources:r.sources,method:r.method,ocrConfidence:r.ocrConfidence||[],extractionError:r.error||'',batch:'letter-library-2026-10-31',review:r.method==='ocr'?'OCR文字待业务核对':'原文待业务核对'}});
  const row={id:result.id,name:r.name,direction:r.direction,type:r.type,reused:result.reused,extractionError:r.error||'',indexed:false};
  results.push(row);console.log(JSON.stringify({progress:results.length,total:records.length,direction:r.direction,reused:result.reused,indexed:row.indexed,error:row.indexError||row.extractionError}));
  await fs.writeFile(path.join(out,'数据库入库结果.json'),JSON.stringify(results,null,2));
 }
 const current=new Map((await knowledge.list()).map(d=>[d.id,d]));
 for(const row of results){const d=current.get(row.id);row.indexed=!!(d?.enabled&&d.chunks);row.chunks=d?.chunks||0;}
 await fs.writeFile(path.join(out,'数据库入库结果.json'),JSON.stringify(results,null,2));
 const summary={at:new Date().toISOString(),documents:results.length,directions:Object.fromEntries(['outgoing','incoming','support'].map(k=>[k,results.filter(r=>r.direction===k).length])),indexed:results.filter(r=>r.indexed).length,chunks:results.reduce((n,r)=>n+(r.chunks||0),0),failures:results.filter(r=>r.indexError||r.extractionError)};
 await fs.writeFile(path.join(out,'数据库入库汇总.json'),JSON.stringify(summary,null,2));console.log(JSON.stringify(summary));
}finally{await repository.close();}
