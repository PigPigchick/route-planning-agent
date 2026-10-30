import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {resolveExportPython} from './backend/python-runtime.mjs';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {renderLetters,handleLetters} from './dist/letters-ui.mjs';

const dir=await mkdtemp(path.join(tmpdir(),'tx-letters-flow-'));
const origin='http://127.0.0.1:4325';
let child,logs='',calls=0,release,invalid=false;
const nativeFetch=globalThis.fetch;
const gate=new Promise(r=>release=r);
const mock=http.createServer(async(req,res)=>{
 try{
  let raw='';for await(const chunk of req)raw+=chunk;
  const b=JSON.parse(raw);assert.equal(b.stream,true);calls++;
  const blocks=['{{projectOverview}}','{{routeSummary}}','{{requestItems}}',...(invalid?['净空99米。']:[])];
  const text=JSON.stringify({bodyBlocks:blocks});
  res.writeHead(200,{'Content-Type':'text/event-stream'});
  const packet=delta=>res.write('data: '+JSON.stringify({choices:[{index:0,delta}]})+'\n\n');
  packet({reasoning_content:'PRIVATE_REASONING_NEVER_PUBLISH'});
  packet({content:text.slice(0,text.indexOf(',')+1)});
  if(calls===1)await gate;
  packet({content:text.slice(text.indexOf(',')+1)});
  res.write('data: '+JSON.stringify({model:'stream-test',choices:[{index:0,delta:{},finish_reason:'stop'}]})+'\n\n');
  res.end('data: [DONE]\n\n');
 }catch(e){console.error(e.message);res.end();}
});
async function post(p,b,status=200){const r=await fetch(origin+p,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;}
let reportNumber=0;
async function checklist(task,{stale=false}={}){
 const file=await post('/api/v1/tasks/'+task.id,{action:'export',format:'materials-docx',stale});
 assert.match(file.name,/资料核对与补充清单\.docx$/);
 const response=await fetch(origin+file.url);assert.match(response.headers.get('content-type'),/wordprocessingml/);
 const bytes=Buffer.from(await response.arrayBuffer());assert.equal(bytes.subarray(0,2).toString(),'PK');
 const output=path.join(dir,'checklist-'+(++reportNumber)+'.docx');await writeFile(output,bytes);
 const python=await resolveExportPython(process.cwd());
 const {stdout}=await promisify(execFile)(python,['-c','import sys,zipfile;print(zipfile.ZipFile(sys.argv[1]).read("word/document.xml").decode("utf-8"))',output]);
 assert.match(stdout,/协议征询函资料核对与补充清单/);assert.ok(stdout.includes(task.input.project.name));
 assert.ok(!stdout.includes('PRIVATE_REASONING'));assert.ok(!stdout.includes('synthetic-workflow'));
 return stdout;
}
async function status(t){return post('/api/v1/tasks/'+t.id,{action:'status'});}
async function until(t,check){for(let n=0;n<160;n++){t=await status(t);if(check(t))return t;await new Promise(r=>setTimeout(r,25));}throw new Error('未观察到预期任务状态：'+JSON.stringify({status:t.status,letters:t.result.letters.map(l=>({status:l.status,error:l.error}))}));}
async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4325',TX_DATA_DIR:dir,LLM_MODEL:'',LLM_API_KEY:'',LLM_STREAM:'false'},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',c=>c&&j(new Error(logs)))});}
async function stop(){if(child){const c=child;child=null;await new Promise(r=>{c.once('exit',r);c.kill();});}}
try{
 await new Promise((r,j)=>{mock.once('error',j);mock.listen(4324,'127.0.0.1',r);});await start();
 await post('/api/v1/model-config',{baseUrl:'http://127.0.0.1:4324/v1',model:'stream-test',apiKey:'synthetic-workflow',stream:true});
 const ctx=await post('/api/v1/context',SAMPLE,201);
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);input.agreements=input.agreements.slice(0,1);input.templateConfirmed=true;
 Object.assign(input.project,{issuer:'测试单位',contactName:'测试联系人',contactPhone:'测试电话',replyAddress:'测试地址'});
 input.agreements[0].attachments=[{name:'路径图.png',kind:'路径图',assetId:'',routeVersion:input.project.version}];
 let t=await post('/api/v1/tasks',{contextId:ctx.contextId,agentType:'letters',routeIds:['A'],options:{mode:'llm',lettersInput:input}},201);
 t=await until(t,t=>!!t.result.letters[0].previewText);
 assert.equal(t.status,'running');assert.equal(t.currentUnit,input.agreements[0].unit);assert.ok(t.startedAt);assert.equal(t.result.letters[0].status,'generating');assert.equal(t.result.letters[0].live.phase,'writing');assert.match(t.result.letters[0].previewText,/电压等级/);assert.deepEqual(t.result.letters[0].bodyBlocks,[]);
 assert.ok(!JSON.stringify(t).includes('PRIVATE_REASONING'));assert.ok(!JSON.stringify(t).includes('synthetic-workflow'));
 await post('/api/v1/tasks/'+t.id,{action:'confirm',letterId:'LETTER-1',expectedRevision:1,reviewer:'QA',note:'不可确认未完成'},400);
 await post('/api/v1/tasks/'+t.id,{action:'export',format:'docx',letterId:'LETTER-1'},400);
 await post('/api/v1/tasks/'+t.id,{action:'update-input',expectedRevision:t.revision,lettersInput:input},400);
 const runningReport=await checklist(t);assert.match(runningReport,/正文生成中/);assert.equal(calls,1);assert.equal((await status(t)).status,'running');
 // Render the actual UI module against live HTTP task snapshots, including reload/resume.
 let uiTask=t,html='',modal,toasts=[];
 const fields=new Map(),field=id=>{if(!fields.has(id))fields.set(id,{value:'',checked:false,textContent:'',close(){}});return fields.get(id);};
 globalThis.document={querySelector:field};
 globalThis.localStorage={getItem:()=>JSON.stringify({input,selected:null}),setItem:()=>{}};
 const env=()=>({context:SAMPLE,routeId:'A',tasks:[uiTask],config:{baseUrl:origin},projectBar:'',routeSelect:'',modal:(title,body,footer)=>modal={title,body,footer},toast:msg=>toasts.push(msg),render:()=>{html=renderLetters(env());},saveTask:task=>uiTask=task});
 let pollingFailure=false;
 globalThis.fetch=async(url,options)=>{
  if(!pollingFailure&&url===origin+'/api/v1/tasks/'+t.id&&options?.body&&JSON.parse(options.body).action==='status'){
   pollingFailure=true;return new Response(JSON.stringify({error:{message:'模拟短暂断网'}}),{status:503});
  }
  return nativeFetch(url,options);
 };
 html=renderLetters(env());assert.doesNotMatch(html,/刷新任务状态|data-op="refresh"/);assert.match(html,/实时正文预览/);assert.match(html,/已等待/);assert.match(html,/当前单位/);assert.match(html,/电压等级/);
 for(let n=0;n<100&&(!pollingFailure||!html.includes('正在自动重试'));n++)await new Promise(r=>setTimeout(r,25));
 assert.equal(pollingFailure,true);assert.match(html,/正在自动重试/);assert.equal(calls,1);globalThis.fetch=nativeFetch;
 release();t=await until(t,t=>t.status!=='running');
 assert.equal(t.result.letters[0].status,'incomplete');
 const report=await checklist(t,{stale:true});assert.match(report,/上一次已同步/);assert.match(report,/路径图实际文件/);assert.match(report,/处理方式/);assert.match(report,/不能判定资料未提供/);assert.equal(calls,1);
 // The UI's watcher must finish and refresh itself, without another generate click.
 for(let n=0;n<100&&uiTask.status==='running';n++)await new Promise(r=>setTimeout(r,25));
 assert.equal(uiTask.status,'awaiting_confirmation');assert.match(html,/资料待处理/);
 await handleLetters({dataset:{op:'confirm'}});assert.match(modal.body,/发函日期/);assert.match(modal.body,/无需调用大模型/);
 const originalBody=structuredClone(t.result.letters[0].bodyBlocks);
 await handleLetters({dataset:{op:'input'}});
 for(const [id,key] of [['li-name','name'],['li-voltage','voltage'],['li-stage','stage'],['li-issuer','issuer'],['li-contact','contactName'],['li-phone','contactPhone'],['li-address','replyAddress'],['li-overview','overview']])field('#'+id).value=input.project[key];
 field('#li-route').value=input.route.summary;field('#li-date').value='2026-10-23';field('#li-template').checked=true;
 await field('#letter-save').onclick();t=uiTask;assert.equal(calls,1);assert.equal(t.input.project.issueDate,'2026-10-23');assert.deepEqual(t.result.letters[0].bodyBlocks,originalBody);assert.match(html,/1 项待处理/);
 await handleLetters({dataset:{op:'attachments',index:'0'}});
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z9ZkAAAAASUVORK5CYII=','base64');
 field('#asset-file').files=[{name:'路径图.png',size:png.length,arrayBuffer:async()=>Uint8Array.from(png).buffer}];field('#asset-kind').value='路径图';
 await field('#asset-upload').onclick();t=uiTask;
 let updated=structuredClone(t.input);assert.ok(updated.agreements[0].attachments[0].assetId);
 assert.equal(calls,1);assert.equal(t.result.letters[0].status,'draft');assert.deepEqual(t.result.letters[0].bodyBlocks,originalBody);
 const rev=t.revision;t=await post('/api/v1/tasks/'+t.id,{action:'update-input',expectedRevision:rev,lettersInput:updated});assert.equal(t.revision,rev);
 t=await post('/api/v1/tasks/'+t.id,{action:'edit',letterId:'LETTER-1',expectedRevision:t.result.letters[0].revision,bodyBlocks:[...originalBody,'请函复管理要求。']});
 const draftDoc=await post('/api/v1/tasks/'+t.id,{action:'export',format:'docx',letterId:'LETTER-1'});assert.match(draftDoc.name,/^草稿_/);
 t=await post('/api/v1/tasks/'+t.id,{action:'confirm',letterId:'LETTER-1',expectedRevision:t.result.letters[0].revision,reviewer:'QA',note:'测试资料齐全'});assert.equal(t.status,'confirmed');
 const confirmedDoc=await post('/api/v1/tasks/'+t.id,{action:'export',format:'docx',letterId:'LETTER-1'});assert.ok(!confirmedDoc.name.startsWith('草稿_'));
 uiTask=t;html=renderLetters(env());await handleLetters({dataset:{op:'replace-asset',index:'0',asset:'0'}});
 const pdf=Buffer.from('QA replacement attachment');field('#asset-file').files=[{name:'替换路径图.pdf',size:pdf.length,arrayBuffer:async()=>Uint8Array.from(pdf).buffer}];field('#asset-kind').value='路径图';
 await field('#asset-upload').onclick();t=uiTask;updated=structuredClone(t.input);assert.equal(calls,1);assert.equal(t.result.letters[0].status,'draft');assert.equal(t.result.letters[0].confirmations.length,1);assert.match(t.result.letters[0].text,/请函复管理要求/);assert.match(t.result.letters[0].text,/替换路径图.pdf/);
 const file=await post('/api/v1/tasks/'+t.id,{action:'export',format:'zip'});const zip=Buffer.from(await(await fetch(origin+file.url)).arrayBuffer());assert.equal(zip.subarray(0,2).toString(),'PK');assert.ok(zip.includes(Buffer.from('替换路径图.pdf')));
 updated.agreements[0].points='已变更的征询事项';
 t=await post('/api/v1/tasks/'+t.id,{action:'update-input',expectedRevision:t.revision,lettersInput:updated});assert.equal(t.result.letters[0].status,'needs_rewrite');assert.equal(calls,1);
 await post('/api/v1/tasks/'+t.id,{action:'export',format:'docx',letterId:'LETTER-1'},400);
 await post('/api/v1/tasks/'+t.id,{action:'confirm',letterId:'LETTER-1',expectedRevision:t.result.letters[0].revision,reviewer:'QA',note:'旧正文不能确认'},400);
 invalid=true;let failed=await post('/api/v1/tasks',{contextId:ctx.contextId,agentType:'letters',routeIds:['A'],options:{mode:'llm',lettersInput:updated}},201);
 failed=await until(failed,t=>t.status!=='running');assert.equal(failed.result.letters[0].status,'failed');assert.match(failed.result.letters[0].error,/新增数值/);assert.deepEqual(failed.result.letters[0].bodyBlocks,[]);assert.equal(calls,3);
 const failedReport=await checklist(failed);assert.match(failedReport,/生成或检查失败/);assert.match(failedReport,/新增数值/);assert.equal(calls,3);
 uiTask=failed;html=renderLetters(env());assert.match(html,/本次输出未采用/);assert.match(html,/新增数值/);assert.match(html,/data-op="confirm" disabled/);
 let deletion=await post('/api/v1/tasks',{contextId:ctx.contextId,agentType:'letters',routeIds:['A'],options:{mode:'template',lettersInput:updated}},201);
 const deletedLetter=structuredClone(deletion.result.letters[0]);
 deletion=await post('/api/v1/tasks/'+deletion.id,{action:'update-input',expectedRevision:deletion.revision,lettersInput:{...updated,agreements:[]}});
 assert.equal(deletion.input.agreements.length,0);assert.equal(deletion.result.letters.length,0);assert.deepEqual(deletion.removedLetters[0].letter,deletedLetter);assert.notEqual(deletion.status,'confirmed');
 await post('/api/v1/tasks/'+deletion.id,{action:'export',format:'xlsx'},400);
 await post('/api/v1/tasks',{contextId:ctx.contextId,agentType:'letters',routeIds:['A'],options:{mode:'template',lettersInput:{...updated,agreements:[]}}},400);
 assert.equal(calls,3);
 const records=await readFile(path.join(dir,'records.json'),'utf8');assert.ok(!records.includes('PRIVATE_REASONING'));assert.ok(!records.includes('synthetic-workflow'));
 await stop();await start();t=await status(t);assert.equal(t.result.letters[0].status,'needs_rewrite');assert.match(t.result.letters[0].text,/请函复管理要求/);
 deletion=await status(deletion);assert.equal(deletion.result.letters.length,0);assert.deepEqual(deletion.removedLetters[0].letter,deletedLetter);assert.notEqual(deletion.status,'confirmed');
 console.log('函件流程联调通过：完成前可读取流式正文；界面显示当前单位与等待时间；刷新后自动跟踪；信息保存和附件替换不调用模型；保留人工正文；修改后复核失效；事实改动阻止旧正文导出与确认；检查失败展示原因；ZIP导出和重启持久化通过；短暂断网后自动恢复查询且不显示手动刷新按钮；资料清单Word支持生成中、缺项、失败及待同步状态，且不调用模型。');
}finally{globalThis.fetch=nativeFetch;release();await stop();await new Promise(r=>mock.close(r));await rm(dir,{recursive:true,force:true});}
