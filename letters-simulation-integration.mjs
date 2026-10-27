import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput,LETTER_TEMPLATES} from './dist/letters-core.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'tx-simulation-')),origin='http://127.0.0.1:4327';
let child,logs='',calls=0,invalid=false,exportFailure=false;
const mock=http.createServer(async(req,res)=>{
 try{let raw='';for await(const c of req)raw+=c;const b=JSON.parse(raw),p=JSON.parse(b.messages[1].content);calls++;
  let output;
  if(p.purpose){output={values:Object.fromEntries(p.fields.map(f=>[f.key,f.type==='number'?12:f.field==='project.issueDate'?'2026-10-23':'模拟测试值'])),attachmentNotes:Object.fromEntries(p.agreements.map(a=>[a.id,'模拟区段及参数，仅用于软件测试。']))};if(invalid)output.values={};}
  else output={bodyBlocks:p.allowedPlaceholders.filter(k=>k!=='{{projectName}}')};
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  res.write('data: '+JSON.stringify({choices:[{index:0,delta:{reasoning_content:'PRIVATE_SIMULATION_REASONING'}}]})+'\n\n');
  const text=JSON.stringify(output);
  for(let i=0;i<text.length;i+=40){res.write('data: '+JSON.stringify({choices:[{index:0,delta:{content:text.slice(i,i+40)}}]})+'\n\n');await new Promise(r=>setTimeout(r,2));}
  res.write('data: '+JSON.stringify({model:'simulation-mock',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');res.end('data: [DONE]\n\n');
 }catch(e){res.writeHead(500);res.end(JSON.stringify({error:{code:'MOCK_FAILURE'}}));}
});
async function post(p,b,code=200){const r=await fetch(origin+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}),v=await r.json();assert.equal(r.status,code,JSON.stringify(v));return v;}
async function wait(t){const stages=new Set();for(let n=0;n<500;n++){t=await post('/api/v1/tasks/'+t.id,{action:'status'});stages.add(t.simulation.stage);if(t.status!=='running')return {task:t,stages};await new Promise(r=>setTimeout(r,20));}throw new Error('模拟超时');}
async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4327',TX_DATA_DIR:dir,...(exportFailure?{TX_PYTHON:'/not-present/simulation-python'}:{})},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>j(new Error(logs)))});}
async function stop(){if(child){const c=child;child=null;await new Promise(r=>{c.once('exit',r);c.kill()});}}
try{
 await new Promise((r,j)=>{mock.once('error',j);mock.listen(4326,'127.0.0.1',r)});await start();
 await post('/api/v1/model-config',{baseUrl:'http://127.0.0.1:4326/v1',model:'simulation-mock',apiKey:'synthetic-simulation-key',stream:true});
 const ctx=await post('/api/v1/context',SAMPLE,201),input=createLettersInput(SAMPLE,SAMPLE.routes[0]);
 input.agreements=LETTER_TEMPLATES.map((tpl,i)=>({id:'SIM-AGR-'+i,unit:'',type:tpl.id,scope:'',points:'',status:'未发函',round:i===4?'revised':'first',previousLetter:'',changeSummary:'',facts:{},attachments:[]}));
 const source=structuredClone(input),base={contextId:ctx.contextId,agentType:'letters',routeIds:['A']};
 const real=await post('/api/v1/tasks',{...base,options:{mode:'template',lettersInput:input}},201);
 let t=await post('/api/v1/tasks',{...base,options:{simulation:true,lettersInput:input}},201);
 assert.equal(t.status,'running');assert.ok(t.simulation);const done=await wait(t);t=done.task;
 assert.equal(t.status,'simulation_completed',JSON.stringify(t));assert.equal(calls,LETTER_TEMPLATES.length+1);assert.ok(done.stages.has('补全资料'));assert.ok(done.stages.has('起草正文'));
 assert.equal(t.result.summary.simulated,LETTER_TEMPLATES.length);assert.equal(t.result.summary.confirmed,0);assert.equal(t.simulation.confirmations.length,LETTER_TEMPLATES.length);
 for(const l of t.result.letters){assert.equal(l.status,'simulated');assert.deepEqual(l.missingFields,[]);assert.deepEqual(l.confirmations,[]);assert.ok(l.attachments.every(a=>a.available&&a.name.startsWith('模拟测试_')));assert.match(l.text,/模拟测试/);}
 assert.deepEqual(input,source);assert.deepEqual(await post('/api/v1/tasks/'+real.id,{action:'status'}),real);
 await post('/api/v1/tasks/'+t.id,{action:'confirm',letterId:'LETTER-1',expectedRevision:1,reviewer:'QA',note:'不能当人工确认'},400);
 await post('/api/v1/tasks/'+t.id,{action:'update-input',expectedRevision:t.revision,lettersInput:input},400);
 const zipResponse=await fetch(origin+t.simulation.export.url),zip=Buffer.from(await zipResponse.arrayBuffer());assert.equal(zip.subarray(0,2).toString(),'PK');assert.match(t.simulation.export.name,/模拟测试/);assert.ok(zip.includes(Buffer.from('模拟流程记录.json')));assert.ok(zip.includes(Buffer.from('模拟测试_')));
 const file=await post('/api/v1/tasks/'+t.id,{action:'export',format:'docx',letterId:'LETTER-1'});assert.equal((await fetch(origin+file.url)).status,200);
 const resources=await (await fetch(origin+'/api/v1/letter-resources')).json();
 const customResources=await post('/api/v1/letter-resources',{action:'save-template',expectedRevision:resources.revision,actor:'模拟测试维护人',template:{...resources.templates[0],name:'含扩展字段与附件的模拟模板',required:[['testDetail','专项测试说明']],attachments:['路径图','自定义测试附件']}});
 const customInput=structuredClone(input);customInput.agreements=customInput.agreements.slice(0,1);customInput.agreements[0].templateId=customResources.templates.at(-1).id;
 const custom=(await wait(await post('/api/v1/tasks',{...base,options:{simulation:true,lettersInput:customInput}},201))).task;
 assert.equal(custom.status,'simulation_completed',custom.error);assert.equal(custom.result.letters[0].missingFields.length,0);assert.ok(custom.result.letters[0].attachments.some(a=>a.kind==='自定义测试附件'&&a.available));
 const before=calls;invalid=true;
 let failed=(await wait(await post('/api/v1/tasks',{...base,options:{simulation:true,lettersInput:input}},201))).task;
 assert.equal(failed.status,'failed');assert.match(failed.error,/模拟补全缺失/);assert.equal(calls,before+1);assert.equal(failed.simulation.export,undefined);assert.deepEqual(failed.simulation.confirmations,[]);
 await post('/api/v1/tasks/'+failed.id,{action:'export',format:'zip'},400);
 await stop();await start();assert.equal((await post('/api/v1/tasks/'+t.id,{action:'status'})).status,'simulation_completed');assert.equal((await fetch(origin+t.simulation.export.url)).status,200);
 invalid=false;exportFailure=true;await stop();await start();
 failed=(await wait(await post('/api/v1/tasks',{...base,options:{simulation:true,lettersInput:{...input,agreements:input.agreements.slice(0,1)}}},201))).task;
 assert.equal(failed.status,'failed');assert.equal(failed.simulation.failedStage,'导出成果');assert.equal(failed.simulation.export,undefined);
 const records=await readFile(path.join(dir,'records.json'),'utf8');assert.ok(!records.includes('PRIVATE_SIMULATION_REASONING'));assert.ok(!records.includes('synthetic-simulation-key'));
 console.log('模拟流程联调通过：全部模板补齐、流式起草、零缺项、独立自动模拟确认、Word/ZIP下载、原任务不变、失败不假成功、导出失败、重启持久化。');
}finally{await stop();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true});}
