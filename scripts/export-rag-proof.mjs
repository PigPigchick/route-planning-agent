import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const base='http://127.0.0.1:4318',out=path.resolve('outputs/函件资料入库_2026-10-31');
const api=async(p,b)=>{const r=await fetch(base+p,{method:b?'POST':'GET',headers:b?{'Content-Type':'application/json'}:undefined,body:b?JSON.stringify(b):undefined});const v=await r.json();assert.ok(r.ok,v.error?.message);return v;};
const {tasks}=await api('/api/v1/tasks'),task=tasks.find(t=>t.projectId==='RAG-VERIFY-20261030');assert.equal(task.result.letters[0].status,'draft');
for(const format of ['docx','zip']){const r=await api('/api/v1/tasks/'+task.id,{action:'export',format,...(format==='docx'?{letterId:task.result.letters[0].id}:{})});const data=await fetch(base+r.url);assert.ok(data.ok);await fs.writeFile(path.join(out,'虚构工程_RAG真实起草验证.'+format),Buffer.from(await data.arrayBuffer()));}
const letter=task.result.letters[0];
const record={at:new Date().toISOString(),taskId:task.id,projectId:task.projectId,model:letter.generation?.model,generation:letter.generation,status:letter.status,retrieval:letter.retrieval,historicalReferences:letter.retrieval.sources.filter(s=>s.metadata.direction==='outgoing').length,body:letter.text,historyTasks:tasks.length};
await fs.writeFile(path.join(out,'真实起草及导出记录.json'),JSON.stringify(record,null,2));console.log(JSON.stringify({taskId:task.id,status:record.status,references:record.retrieval.sources.length,formats:['docx','zip'],historyTasks:tasks.length}));
