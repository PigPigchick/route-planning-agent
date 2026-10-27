import assert from 'node:assert/strict';import http from 'node:http';import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile} from 'node:fs/promises';import {tmpdir} from 'node:os';import path from 'node:path';
import {SAMPLE} from './dist/engine.mjs';import {createLettersInput} from './dist/letters-core.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'tx-shared-'));let child,logs='',releaseFirst,notifyFirst;const firstArrived=new Promise(r=>notifyFirst=r),firstGate=new Promise(r=>releaseFirst=r),calls=[];
const mock=http.createServer(async(req,res)=>{try{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw);assert.equal(req.headers.authorization,b.model==='model-a'?'Bearer synthetic-a':'Bearer synthetic-b');calls.push(b.model);if(calls.length===1){notifyFirst();await firstGate}const m=JSON.parse(b.messages[1].content);let out;if(m.sections)out={sections:m.sections.map(s=>({id:s.id,bodyBlocks:s.allowedPlaceholders}))};else out={bodyBlocks:['{{projectOverview}}','{{routeSummary}}','{{requestItems}}']};res.writeHead(200,{'Content-Type':'application/json'});res.end(JSON.stringify({model:b.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify(out)}}]}))}catch(e){res.writeHead(500);res.end('{}');console.error(e.message)}});
async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4322',TX_DATA_DIR:dir,LLM_API_KEY:'',LLM_MODEL:'',LLM_BASE_URL:'',LLM_JSON_MODE:'true',LLM_STREAM:'false',LLM_THINKING_MODE:'auto'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>c&&j(new Error(logs)))})}
async function stop(){if(!child)return;const c=child;child=null;await new Promise(r=>{c.once('exit',r);c.kill()})}
async function post(p,b){const r=await fetch('http://127.0.0.1:4322'+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const v=await r.json();assert.equal(r.status<300,true,JSON.stringify(v));return v}
async function finish(t){for(let i=0;i<100&&t.status==='running';i++){await new Promise(r=>setTimeout(r,20));t=await post('/api/v1/tasks/'+t.id,{action:'status'})}assert.equal(t.status,'awaiting_confirmation',JSON.stringify(t.error));return t}
try{
 await new Promise((r,j)=>{mock.once('error',j);mock.listen(4323,'127.0.0.1',r)});await start();
 const a=await post('/api/v1/model-config',{baseUrl:'http://127.0.0.1:4323/v1',model:'model-a',apiKey:'synthetic-a',jsonMode:true,stream:false,thinkingMode:'auto'});
 const ctx=await post('/api/v1/context',SAMPLE);
 let comparison=await post('/api/v1/tasks',{contextId:ctx.contextId,agentType:'comparison',routeIds:['A','B']});assert.equal(comparison.status,'running');assert.equal(comparison.modelConfig.model,'model-a');
 await Promise.race([firstArrived,new Promise((_,j)=>setTimeout(()=>j(new Error('模型请求未发出')),3000))]);
 const b=await post('/api/v1/model-config',{expectedRevision:a.revision,model:'model-b',apiKey:'synthetic-b'});assert.equal(b.revision,a.revision+1);releaseFirst();comparison=await finish(comparison);assert.equal(comparison.modelConfig.revision,a.revision);assert.deepEqual(calls,['model-a','model-a']);
 for(const agentType of ['compliance','description','letters']){
  const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);input.agreements=input.agreements.slice(0,1);
  const request={contextId:ctx.contextId,agentType,routeIds:['A'],...(agentType==='letters'?{options:{lettersInput:input}}:{})};let t=await finish(await post('/api/v1/tasks',request));assert.equal(t.modelConfig.model,'model-b');assert.equal(t.modelConfig.revision,b.revision);
  if(agentType==='letters')assert.equal(t.result.letters[0].generation.model,'model-b');else assert.equal(t.generation.model,'model-b');
 }
 assert.deepEqual(calls,['model-a','model-a','model-b','model-b','model-b']);
 const unchanged=await post('/api/v1/model-config',{expectedRevision:b.revision,model:'model-b',apiKey:''});assert.equal(unchanged.unchanged,true);assert.equal(unchanged.revision,b.revision);
 const records=await readFile(path.join(dir,'records.json'),'utf8');assert.ok(!records.includes('synthetic-a')&&!records.includes('synthetic-b'));
 await stop();await start();const current=await(await fetch('http://127.0.0.1:4322/api/v1/model-config')).json();assert.equal(current.model,'model-b');assert.equal(current.revision,b.revision);assert.equal(current.keyConfigured,true);assert.ok(!JSON.stringify(current).includes('synthetic-b'));assert.equal((await post('/api/v1/tasks/'+comparison.id,{action:'status'})).modelConfig.model,'model-a');
 console.log('共享配置联调通过：四智能体共用配置；运行中比选两次调用始终使用旧配置；修改后其余任务使用新配置；无修改沿用版本；空密钥保留；重启后配置及历史快照保留；密钥不进入任务和查询。');
}finally{releaseFirst();await stop();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true})}
