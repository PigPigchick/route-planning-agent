import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {resolveExportPython} from './backend/python-runtime.mjs';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {renderLetters,handleLetters} from './dist/letters-ui.mjs';
const dir=await mkdtemp(path.join(tmpdir(),'tx-letter-management-')),origin='http://127.0.0.1:4328';let child,logs='';
async function api(p,b,code=200){const r=await fetch(origin+p,{method:b?'POST':'GET',headers:b?{'Content-Type':'application/json'}:undefined,body:b?JSON.stringify(b):undefined}),v=await r.json();assert.equal(r.status,code,JSON.stringify(v));return v;}
async function start(){child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'4328',TX_DATA_DIR:dir,LLM_MODEL:'',LLM_API_KEY:''},stdio:['ignore','pipe','pipe']});child.stdout.on('data',d=>logs+=d);child.stderr.on('data',d=>logs+=d);await new Promise((r,j)=>{child.stdout.once('data',r);child.once('error',j);child.once('exit',()=>j(new Error(logs)))});}
async function stop(){if(child){const c=child;child=null;await new Promise(r=>{c.once('exit',r);c.kill()})}}
const fields=new Map(),field=id=>{if(!fields.has(id))fields.set(id,{value:'',checked:false,textContent:'',disabled:false,files:[],close(){}});return fields.get(id)};
globalThis.document={querySelector:field};const storage=new Map();globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
let modal,html='',tasks=[],input,context,env;const toasts=[];
function setupUI(nextInput,nextTasks=[]){input=structuredClone(nextInput);tasks=nextTasks;storage.set('tx-letters-v2-'+context.project.id+'-'+context.project.version+'-A',JSON.stringify({input,selected:input.agreements.map(a=>a.id)}));env={context,routeId:'A',tasks,config:{baseUrl:origin},projectBar:'',routeSelect:'',modal:(title,body,footer)=>modal={title,body,footer},toast:t=>toasts.push(t),download:(...args)=>{},saveTask:t=>{tasks=[t,...tasks.filter(x=>x.id!==t.id)];env.tasks=tasks},render:()=>{html=renderLetters(env)}};env.render();}
function fillTemplate(name,body){for(const [id,value] of Object.entries({'tpl-name':name,'tpl-source':'测试业务确认模板','tpl-purpose':'一般路径测试','tpl-body':body.join('\n\n'),'tpl-attachments':'路径图','tpl-required':'[]','tpl-actor':'集成测试维护人'}))field('#'+id).value=value;}
try{
 await start();context=structuredClone(SAMPLE);context.project.id='PROJECT-MANAGEMENT-TEST';const c=await api('/api/v1/context',context,201);
 input=createLettersInput(context,context.routes[0]);input.agreements=input.agreements.slice(0,1);input.templateConfirmed=true;Object.assign(input.project,{issueDate:'2026-10-25',issuer:'测试发函单位',contactName:'测试联系人',contactPhone:'测试电话',replyAddress:'测试地址'});setupUI(input);
 // Exercise actual page buttons/forms against the live API, without a browser.
 await handleLetters({dataset:{op:'manage-templates'}});assert.match(modal.body,/一般路径征询/);field('#tpl-new').onclick();field('#tpl-type').value='general';
 const body=['模板示例','{{projectOverview}}','{{routeSummary}}','{{requestItems}}'];fillTemplate('测试自定义模板',body);await field('#tpl-save').onclick();
 let resources=await api('/api/v1/letter-resources');assert.equal(resources.templates.length,10);const template=resources.templates.at(-1);assert.equal(template.version,'1.0');
 // Directory and spatial-relation import forms persist independently of tasks.
 await handleLetters({dataset:{op:'manage-directory'}});field('#directory-authorities').onclick();field('#directory-json').value=JSON.stringify({areas:[{code:'DEMO',name:'模拟区',source:'测试数据'}],authorities:[{id:'UNIT-A',unit:'模拟主管甲',areaCodes:['DEMO'],types:['general'],relationTypes:['涉及'],basis:'测试业务认定依据甲',role:'主管单位'},{id:'UNIT-B',unit:'模拟管理乙',areaCodes:['DEMO'],types:['general'],relationTypes:['涉及'],basis:'测试业务认定依据乙',role:'管理单位'}]});field('#directory-actor').value='目录维护人';await field('#directory-save').onclick();
 field('#directory-relations').onclick();const relation={id:'REL-1',projectId:context.project.id,routeId:'A',routeVersion:context.project.version,segmentId:'SEG-1',scope:'模拟T001—T002',featureId:'FEATURE-1',featureName:'测试设施',relationType:'涉及',type:'general',areaCodes:['DEMO'],points:'征询测试事项',evidence:'测试空间关系及触发依据',reviewed:true};field('#directory-json').value=JSON.stringify({relations:[relation,{...relation,id:'REL-OLD',routeVersion:'old'}]});field('#directory-actor').value='关系维护人';await field('#directory-save').onclick();
 await handleLetters({dataset:{op:'recommend-recipients'}});assert.match(modal.body,/多个候选待确认/);assert.match(modal.body,/已排除 1 条/);field('#candidate-0').checked=true;field('#candidate-1').checked=false;field('#recipient-reviewer').value='业务确认人';field('#recipient-check').checked=true;await field('#recipient-apply').onclick();
 const saved=JSON.parse(storage.get('tx-letters-v2-'+context.project.id+'-'+context.project.version+'-A'));assert.equal(saved.input.agreements.length,2);assert.equal(saved.input.agreements[1].unit,'模拟主管甲');assert.equal(saved.input.agreements[1].recipientEvidence.confirmedBy,'业务确认人');assert.equal(tasks.length,0);assert.match(html,/尚未生成函件/);
 // Make one complete, selected letter using the maintained custom template.
 const asset=await api('/api/v1/assets',{name:'测试路径图.txt',base64:Buffer.from('仅供联调的测试路径附件').toString('base64')},201);const complete=structuredClone(input);complete.agreements[0].templateId=template.id;complete.agreements[0].attachments=[{name:asset.name,kind:'路径图',assetId:asset.id,routeVersion:complete.project.version}];
 const request={contextId:c.contextId,agentType:'letters',routeIds:['A'],options:{mode:'template',lettersInput:complete,agreementIds:[complete.agreements[0].id]}};let task=await api('/api/v1/tasks',request,201);assert.equal(task.result.letters[0].status,'draft');assert.match(task.result.letters[0].text,/模板示例/);assert.equal(task.result.letters[0].routeId,'A');
 // Edit and stop template through forms; the already-created task stays on v1.
 await handleLetters({dataset:{op:'manage-templates'}});field('#tpl-edit-9').onclick();fillTemplate('测试模板第二版',['新版结构','{{projectOverview}}','{{routeSummary}}','{{requestItems}}']);await field('#tpl-save').onclick();resources=await api('/api/v1/letter-resources');assert.equal(resources.templates.at(-1).version,'2.0');
 field('#tpl-toggle-9').onclick();field('#tpl-actor').value='模板维护人';await field('#tpl-apply').onclick();await api('/api/v1/tasks',request,400);
 task=await api('/api/v1/tasks/'+task.id,{action:'status'});assert.equal(task.result.letters[0].templateRef.version,'1.0');const bodyBefore=task.result.letters[0].bodyBlocks;
 // Reload UI module so its input cache matches this independent task fixture.
 setupUI(complete,[task]);const ui=await import('./dist/letters-ui.mjs?management='+crypto.randomUUID());env.render=()=>{html=ui.renderLetters(env)};env.render();
 await ui.handleLetters({dataset:{op:'confirm'}});field('#lr-name').value='测试审校人';field('#lr-note').value='已核对测试正文、参数与实际附件';field('#lr-check').checked=true;await field('#letter-save').onclick();task=tasks[0];assert.equal(task.status,'confirmed');
 for(const [state,summary,closure] of [['已发出待回复','',''],['已回复','=测试回复文本',''],['已闭环','=测试回复文本','业务人员记录处理结果']]){
  await ui.handleLetters({dataset:{op:'correspondence'}});field('#ledger-state').value=state;field('#ledger-sent').value='2026-10-25';field('#ledger-replied').value=state==='已发出待回复'?'':'2026-10-25';field('#ledger-summary').value=summary;field('#ledger-closure').value=closure;field('#ledger-reference').value='测试文号';field('#ledger-notes').value='测试备注';field('#ledger-correction').value='';field('#ledger-actor').value='台账登记人';await field('#ledger-save').onclick();task=tasks[0];assert.equal(task.result.letters[0].correspondence.state,state);
 }
 assert.equal(task.result.letters[0].correspondenceHistory.length,3);assert.equal(task.result.letters[0].confirmations.length,1);assert.deepEqual(task.result.letters[0].bodyBlocks,bodyBefore);
 const xlsx=await api('/api/v1/tasks/'+task.id,{action:'export',format:'xlsx'}),response=await fetch(origin+xlsx.url);assert.match(response.headers.get('content-type'),/spreadsheetml/);await writeFile(path.join(dir,'ledger.xlsx'),Buffer.from(await response.arrayBuffer()));
 const zip=await api('/api/v1/tasks/'+task.id,{action:'export',format:'zip'});await writeFile(path.join(dir,'letters.zip'),Buffer.from(await(await fetch(origin+zip.url)).arrayBuffer()));
 const python=await resolveExportPython(process.cwd());
 const check=spawn(python,['-c',`import sys,zipfile,io,json,xml.etree.ElementTree as E
p=sys.argv[1];ns={'m':'http://schemas.openxmlformats.org/spreadsheetml/2006/main'}
def sheet(content):
 with zipfile.ZipFile(io.BytesIO(content)) as z:
  assert z.testzip() is None
  root=E.fromstring(z.read('xl/worksheets/sheet1.xml'));cells={}
  for c in root.findall('.//m:c',ns):
   t=c.find('m:is/m:t',ns);v=c.find('m:v',ns);cells[c.attrib['r']]=(t.text if t is not None else v.text if v is not None else '',c.attrib.get('t'))
  return root,cells
root,cells=sheet(open(p+'/ledger.xlsx','rb').read())
assert root.find('m:dimension',ns).attrib['ref']=='A1:Z2'
assert root.find('m:sheetViews/m:sheetView/m:pane',ns).attrib['topLeftCell']=='E2'
assert root.find('m:autoFilter',ns).attrib['ref']=='A1:Z2'
assert cells['O2'][0]=='已闭环' and cells['S2']==('=测试回复文本','inlineStr')
assert cells['D2'][0]=='A' and cells['L2'][0].endswith('v1.0')
with zipfile.ZipFile(p+'/letters.zip') as z:
 assert '协议征询台账.xlsx' in z.namelist()
 assert len(json.loads(z.read('发出与反馈变更记录.json'))[0]['history'])==3
 assert sheet(z.read('协议征询台账.xlsx'))[1]['O2'][0]=='已闭环'
print('XLSX与ZIP内容核验通过')`,dir],{stdio:['ignore','pipe','pipe']});let checkOutput='';check.stdout.on('data',d=>checkOutput+=d);check.stderr.on('data',d=>checkOutput+=d);assert.equal(await new Promise(r=>check.on('close',r)),0,checkOutput);
 // Ordinary input save preserves business history and original template snapshot.
 const changed=structuredClone(complete);changed.project.issueDate='2026-10-26';task=await api('/api/v1/tasks/'+task.id,{action:'update-input',lettersInput:changed,expectedRevision:task.revision});assert.equal(task.result.letters[0].correspondence.state,'已闭环');assert.equal(task.result.letters[0].templateRef.version,'1.0');assert.equal(task.result.letters[0].status,'draft');
 const bad=structuredClone(complete);delete bad.agreements[0].templateId;Object.assign(bad.agreements[0],{authorityId:'UNIT-A',adminAreaCodes:['INVALID'],unit:'错误名称'});const blocked=await api('/api/v1/tasks',{...request,options:{mode:'template',lettersInput:bad}},201);assert.equal(blocked.result.letters[0].status,'blocked');assert.ok(blocked.result.letters[0].validationChecks.some(c=>c.status==='failed'));await api('/api/v1/tasks/'+blocked.id,{action:'export',format:'docx',letterId:'LETTER-1'},400);
 // XLSX remains available for incomplete/blocked task tracking.
 await api('/api/v1/tasks/'+blocked.id,{action:'export',format:'xlsx'});
 await stop();await start();const persisted=await api('/api/v1/tasks/'+task.id,{action:'status'});assert.equal(persisted.result.letters[0].correspondenceHistory.length,3);assert.equal((await api('/api/v1/letter-resources')).templates.at(-1).enabled,false);assert.equal((await fetch(origin+xlsx.url)).status,200);
 console.log('新增功能联调通过：真实页面模块→API→持久化；模板增改停/历史版本；目录与空间关系导入及人工确认候选；区划/单位冲突阻断；发出回复闭环记录；Excel/ZIP文件内容及重启恢复。');
}finally{await stop();await rm(dir,{recursive:true,force:true});}
