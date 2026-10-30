import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {workbookToLetters,workbookProjects,letterContext} from './dist/letter-table.mjs';
import {resolveExportPython} from './backend/python-runtime.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'tx-excel-import-')),origin='http://127.0.0.1:4332';
let child,logs='';
async function api(p,b,status=200){const r=await fetch(origin+p,{method:b?'POST':'GET',headers:b?{'Content-Type':'application/json'}:undefined,body:b?JSON.stringify(b):undefined});const v=await r.json();assert.equal(r.status,status,JSON.stringify(v));return v;}
try{
 child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4332',TX_DATA_DIR:dir,LLM_MODEL:'',LLM_API_KEY:''},stdio:['ignore','pipe','pipe']});child.stdout.on('data',x=>logs+=x);child.stderr.on('data',x=>logs+=x);
 await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',()=>j(new Error(logs)))});
 const workbook=await api('/api/v1/letter-input/parse',{name:'征询函输入模板.xlsx',base64:(await readFile('dist/assets/征询函输入模板.xlsx')).toString('base64')});
 const values={'工程编号':'IMPORT-TEST','工程名称':'表格导入测试工程','工程版本':'test-v1','路径编号':'A','电压等级':'500kV','设计阶段':'初步设计','工程概况':'工程概况由测试数据填写。','路径描述':'路径说明由测试数据填写。','发函单位':'测试发函单位','发函日期':'2026-10-28','联系人':'测试联系人','联系电话':'测试电话','复函地址':'测试地址','是否测试样例':'是'};
 workbook.sheets.find(s=>s.name==='工程信息').rows.slice(1).forEach(r=>r[1]=values[r[0]]||'');
 workbook.sheets.find(s=>s.name==='协议清单').rows.push(...[1,2,3].map(i=>['XL-'+i,'测试区','测试单位'+i,'一般路径征询','请就本次路径协调事项提出意见。','首次','未发函']));
 workbook.sheets.find(s=>s.name==='附件清单').rows.push(...[1,2,3].map(i=>['XL-'+i,'路径图','测试路径'+i+'.txt','仅测试的附件']));
 const p=workbookToLetters(workbook,createLettersInput(SAMPLE,SAMPLE.routes[0]));
 for(const a of p.pendingAssets){const asset=await api('/api/v1/assets',{name:a.name,base64:Buffer.from(a.content).toString('base64')},201);p.input.agreements.find(x=>x.id===a.agreementId).attachments[a.attachmentIndex].assetId=asset.id;}
 p.input.templateConfirmed=true;
 const context=await api('/api/v1/context',letterContext(p.input),201);
 await api('/api/v1/tasks',{contextId:context.contextId,agentType:'comparison',routeIds:['A']},400);
 const task=await api('/api/v1/tasks',{contextId:context.contextId,agentType:'letters',routeIds:['A'],options:{mode:'template',lettersInput:p.input,agreementIds:p.input.agreements.map(a=>a.id)}},201);
 assert.equal(task.result.letters.length,3);assert.ok(task.result.letters.every(x=>x.status==='draft'&&x.missingFields.length===0));
 for(const [format,letterId] of [['docx','LETTER-1'],['zip',undefined],['xlsx',undefined]]){const f=await api('/api/v1/tasks/'+task.id,{action:'export',format,letterId});const r=await fetch(origin+f.url);assert.equal(r.status,200);await writeFile(path.join(dir,'result.'+format),Buffer.from(await r.arrayBuffer()));}
 const python=await resolveExportPython(process.cwd());
 const check=spawn(python,['-c',`import sys,zipfile,xml.etree.ElementTree as E
p=sys.argv[1]
with zipfile.ZipFile(p+'/result.zip') as z:
 assert len([n for n in z.namelist() if n.endswith('.docx')])==3
 assert len([n for n in z.namelist() if n.endswith('.txt')])>=3
 assert '协议征询台账.xlsx' in z.namelist()
with zipfile.ZipFile(p+'/result.docx') as z:
 t=''.join(E.fromstring(z.read('word/document.xml')).itertext());assert '测试单位1' in t and '测试发函单位' in t
with zipfile.ZipFile(p+'/result.xlsx') as z:
 assert z.testzip() is None
print('三份Word、实际附件、ZIP及Excel台账检查通过')`,dir],{stdio:['ignore','pipe','pipe']});let result='';check.stdout.on('data',d=>result+=d);check.stderr.on('data',d=>result+=d);assert.equal(await new Promise(r=>check.on('close',r)),0,result);
 const multi=await api('/api/v1/letter-input/parse',{name:'四工程.xlsx',base64:(await readFile('dist/assets/征询函输入测试样例_四工程.xlsx')).toString('base64')});
 const projects=workbookProjects(multi);assert.equal(projects.length,4);const counts=[67,35,19,42];
 for(const [i,project] of projects.entries()){
  const p=workbookToLetters(multi,createLettersInput(SAMPLE,SAMPLE.routes[0]),project.code);assert.equal(p.input.agreements.length,counts[i]);assert.equal(p.selectedIds.length,1);assert.equal(p.pendingAssets.length,1);
  for(const a of p.pendingAssets){const asset=await api('/api/v1/assets',{name:a.name,base64:Buffer.from(a.content).toString('base64')},201);p.input.agreements.find(x=>x.id===a.agreementId).attachments[a.attachmentIndex].assetId=asset.id;}
  p.input.templateConfirmed=true;const c=await api('/api/v1/context',letterContext(p.input),201);
  const result=await api('/api/v1/tasks',{contextId:c.contextId,agentType:'letters',routeIds:[p.input.route.id],options:{mode:'template',lettersInput:p.input,agreementIds:p.selectedIds}},201);
  assert.equal(result.result.letters.length,1);assert.equal(result.result.letters[0].status,'draft');assert.equal(result.result.letters[0].missingFields.length,0);assert.equal(result.result.letters[0].agreementIds[0],p.selectedIds[0]);
 }
 console.log('Excel接口→解析字段→独立工程上下文→附件→模板草稿→Word/ZIP/Excel联调通过；四工程163条清单隔离正确，每工程1条完整测试事项。未调用大模型。');
}finally{if(child&&child.exitCode===null){await new Promise(r=>{child.once('exit',r);child.kill()});}await rm(dir,{recursive:true,force:true});}
