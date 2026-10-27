import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {validateContext,makeTask,confirmTask} from './dist/engine.mjs';
import {reviewLetter,createLettersInput,updateLettersInput,letterReadyStatus,refreshSummary,LETTER_TEMPLATES,resolveLetterTemplate} from './dist/letters-core.mjs';
import {modelStore,loadLocalEnv,chatJSON,modelConfigSnapshot} from './backend/model.mjs';
import {createLettersTask,generateLetters} from './backend/letters-agent.mjs';
import {createDesignTask,generateDesign} from './backend/design-agents.mjs';
import {resolveExportPython} from './backend/python-runtime.mjs';
import {createLetterResources,upgradeLetterResources,updateLetterResources,recommendRecipients,validateRecipientReferences} from './backend/letter-resources.mjs';
import {recordCorrespondence} from './backend/letter-ledger.mjs';
import {runSimulation} from './backend/letters-simulation.mjs';
const root=path.dirname(fileURLToPath(import.meta.url));await loadLocalEnv(root);
const stateDir=process.env.TX_DATA_DIR||path.join(root,'.local-data'),port=Number(process.env.PORT||4318);
await fs.mkdir(stateDir,{recursive:true});await fs.mkdir(path.join(stateDir,'assets'),{recursive:true});await fs.mkdir(path.join(stateDir,'exports'),{recursive:true});
const model=await modelStore(stateDir),stateFile=path.join(stateDir,'records.json');let db={contexts:{},tasks:{},assets:{},files:{}};
try{db={...db,...JSON.parse(await fs.readFile(stateFile,'utf8'))}}catch(e){if(e.code!=='ENOENT')throw e}
db.letterResources??=createLetterResources();
const upgradedResources=upgradeLetterResources(db.letterResources),resourcesUpgraded=upgradedResources!==db.letterResources;db.letterResources=upgradedResources;
for(const task of Object.values(db.tasks))if(task.status==='running'&&['letters-v2','design-v2'].includes(task.schemaVersion)){task.status='failed';task.error='服务曾中断，请重新起草';task.finishedAt=new Date().toISOString();if(task.schemaVersion==='letters-v2'){for(const l of task.result.letters)if(['pending','generating','checking'].includes(l.status)){l.status='failed';l.error=task.error;l.text=task.error;l.live={...l.live,phase:'failed'};l.finishedAt=task.finishedAt}}else{task.result.text=task.error;for(const c of task.result.chapters||[])c.text=task.error;}}
for(const task of Object.values(db.tasks))if(task.schemaVersion==='letters-v2'){for(const letter of task.result.letters)if(letter.status==='draft')letter.status=letterReadyStatus(letter);refreshSummary(task);}
let writes=Promise.resolve();function save(){const snapshot=JSON.stringify(db);writes=writes.catch(()=>{}).then(async()=>{await fs.writeFile(stateFile+'.tmp',snapshot,{mode:0o600});await fs.rename(stateFile+'.tmp',stateFile)});return writes}
if(resourcesUpgraded)await save();
const allowed=new Set((process.env.TX_ALLOWED_ORIGINS||'http://127.0.0.1:5173,http://localhost:5173').split(',').filter(Boolean));
function json(res,status,value){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value))}
async function body(req){let chunks=[],size=0;for await(const c of req){size+=c.length;if(size>15*1024*1024)throw new Error('请求不能超过 15MB');chunks.push(c)}try{return JSON.parse(Buffer.concat(chunks).toString())}catch{throw new Error('请求体须为有效 JSON')}}
async function assetsOnDisk(){const assets={};for(const [id,a] of Object.entries(db.assets)){try{await fs.access(a.path);assets[id]=a}catch{}}return assets}
async function simulationAssets(input,ids,notes,templateCatalog){
 const assets={};
 for(const a of input.agreements.filter(a=>ids.includes(a.id))){
  const kinds=[...new Set([...a.attachments.map(x=>x.kind),...resolveLetterTemplate(a,templateCatalog).attachments])];
  a.attachments=[];
  for(const kind of kinds){
   const id='ASSET-'+crypto.randomUUID(),name='模拟测试_'+kind.replace(/[\\/:*?"<>|\x00-\x1f]/g,'_').slice(0,60)+'_文字占位.txt',file=path.join(stateDir,'assets',id+'.txt');
   const content='模拟测试附件 · 非真实工程资料\n此文件仅验证上传关联和导出流程，不是真实图纸、坐标表或测量结果。\n类型：'+kind+'\n协议单位：'+a.unit+'\n路径版本：'+input.project.version+'\n\n'+notes[a.id]+'\n\n虚构专项参数：\n'+JSON.stringify(a.facts||{},null,2);
   await fs.writeFile(file,content,{mode:0o600});assets[id]=db.assets[id]={id,name,path:file,size:Buffer.byteLength(content),simulation:true};a.attachments.push({name,kind,assetId:id,routeVersion:input.project.version});
  }
 }
 await save();return assets;
}
async function exportTask(task,b){
 const letters=b.letterId?task.result.letters.filter(l=>l.id===b.letterId):task.result.letters;
 if(!letters.length||b.format!=='xlsx'&&letters.some(l=>!['draft','confirmed',...(task.simulation?['simulated']:[])].includes(l.status)))throw new Error('所选函件存在阻断项或生成失败，请修正后再导出');
 if(b.format!=='xlsx'&&task.simulation&&letters.some(l=>l.status!=='simulated'))throw new Error('模拟流程未完成检查和自动模拟确认，不能导出');
 if(!['docx','zip','xlsx'].includes(b.format)||b.format==='docx'&&letters.length!==1)throw new Error('请选择单函Word、批量ZIP或Excel台账导出');
 const id='FILE-'+crypto.randomUUID(),output=path.join(stateDir,'exports',id+'.'+b.format);
 const exportAssets=await assetsOnDisk();
 if(b.format!=='xlsx'&&letters.some(l=>l.attachments.some(a=>!a.assetId||!exportAssets[a.assetId])))throw new Error('实际附件不存在或已移除，请重新关联文件并核对后导出');
 const python=await resolveExportPython(root);
 await new Promise((resolve,reject)=>{const child=spawn(python,[path.join(root,'backend/export_letters.py')],{stdio:['pipe','pipe','pipe'],timeout:30000});let err='';child.stderr.on('data',c=>err+=c);child.on('error',()=>reject(new Error('无法启动 Word 导出，请配置 TX_PYTHON 并安装 python-docx')));child.on('close',code=>code===0?resolve():reject(new Error('Word 导出失败，请检查 Python 和 python-docx 环境')));child.stdin.on('error',()=>{});child.stdin.end(JSON.stringify({output,format:b.format,letters,assets:exportAssets,simulation:task.simulation||null}));});
 const name=(task.simulation?'模拟测试_':'')+(b.format==='docx'?letters[0].unit+'_征询函':b.format==='xlsx'?'协议征询台账':'协议征询函件包')+'.'+b.format;db.files[id]={path:output,name};await save();return {fileId:id,name,url:'/api/v1/files/'+id};
}
const server=http.createServer(async(req,res)=>{try{
 const host=req.headers.host||'',origin=req.headers.origin;
 if(!new Set([`127.0.0.1:${port}`,`localhost:${port}`]).has(host)){json(res,403,{error:{code:'HOST_DENIED',message:'仅允许本机访问'}});return}
 if(origin&&!allowed.has(origin)&&origin!==`http://${host}`){json(res,403,{error:{code:'ORIGIN_DENIED',message:'来源未加入 TX_ALLOWED_ORIGINS'}});return}
 if(origin){res.setHeader('Access-Control-Allow-Origin',origin);res.setHeader('Vary','Origin');res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type')}
 if(req.method==='OPTIONS'){res.writeHead(204);res.end();return}
 const p=new URL(req.url,'http://localhost').pathname;
 if(req.method==='GET'&&p==='/api/v1/letter-resources'){json(res,200,db.letterResources);return}
 if(req.method==='GET'&&p==='/api/v1/model-config'){json(res,200,model.publicView());return}
 const fileMatch=p.match(/^\/api\/v1\/files\/([A-Za-z0-9-]+)$/);
 if(req.method==='GET'&&fileMatch){const f=db.files[fileMatch[1]];if(!f){json(res,404,{error:{message:'导出文件不存在'}});return}const content=await fs.readFile(f.path);res.writeHead(200,{'Content-Type':f.name.endsWith('.zip')?'application/zip':f.name.endsWith('.xlsx')?'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename*=UTF-8''${encodeURIComponent(f.name)}`,'Cache-Control':'no-store'});res.end(content);return}
 if(req.method!=='POST'){json(res,404,{error:{message:'这是后端服务，请在 http://127.0.0.1:5173 打开前端'}});return}
 if(!req.headers['content-type']?.startsWith('application/json'))throw new Error('请使用 application/json');const b=await body(req);
 if(p==='/api/v1/letter-resources'){if(b.action==='recommend'){json(res,200,recommendRecipients(db.letterResources,b.lettersInput));return}db.letterResources=updateLetterResources(db.letterResources,b);await save();json(res,200,db.letterResources);return}
 if(p==='/api/v1/model-config'){json(res,200,await model.update(b));return}
 if(p==='/api/v1/model-test'){const r=await chatJSON(model.get(),[{role:'system',content:'仅输出JSON对象。'},{role:'user',content:'返回 {"ok":true}，用于连通性检查，不生成其他内容。'}],{timeout:180000});if(r.output.ok!==true)throw new Error('已收到模型响应，但 JSON 格式检查未通过');json(res,200,{ok:true,model:r.model,durationMs:r.durationMs,stream:r.stream,thinkingMode:r.thinkingMode,usage:r.usage});return}
 if(p==='/api/v1/assets'){
  const name=path.basename(String(b.name||'')),extension=path.extname(name).toLowerCase();if(!['.pdf','.docx','.doc','.xlsx','.xls','.csv','.txt','.png','.jpg','.jpeg','.dwg','.dxf'].includes(extension))throw new Error('附件类型不支持');
  if(typeof b.base64!=='string'||!/^[A-Za-z0-9+/]*={0,2}$/.test(b.base64))throw new Error('附件编码无效');const bytes=Buffer.from(b.base64,'base64');if(!bytes.length||bytes.length>10*1024*1024)throw new Error('单个附件须为 1 字节至 10MB');
  const id='ASSET-'+crypto.randomUUID(),file=path.join(stateDir,'assets',id+extension);await fs.writeFile(file,bytes,{mode:0o600});db.assets[id]={id,name,path:file,size:bytes.length};await save();json(res,201,{id,name,size:bytes.length});return;
 }
 if(p==='/api/v1/context'){validateContext(b);const existing=Object.values(db.contexts).find(x=>x.context.project.id===b.project.id&&x.context.project.version===b.project.version);if(existing){if(JSON.stringify(existing.context)!==JSON.stringify(b))throw new Error('同一工程快照不可覆盖，请更新 project.version');json(res,200,{contextId:existing.id});return}const id='CTX-'+crypto.randomUUID();db.contexts[id]={id,context:b};await save();json(res,201,{contextId:id});return}
 if(p==='/api/v1/tasks'){
  const ctx=db.contexts[b.contextId];if(!ctx)throw new Error('工程上下文不存在');
  const simulation=b.agentType==='letters'&&b.options?.simulation===true;
  const snapshot=model.get(),mode=simulation?'llm':b.options?.mode||((snapshot.apiKey||snapshot.model)?'llm':'template');
  if(!['llm','template'].includes(mode))throw new Error('生成模式须为 llm 或 template');
  if(mode==='llm'&&(!snapshot.apiKey||!snapshot.model))throw new Error('请先在共享“大模型配置”填写模型名称和 API Key');
  b.options={...b.options,mode};let task;
  if(b.agentType==='letters'){
   if(!b.options.lettersInput){const route=ctx.context.routes.find(r=>r.id===b.routeIds?.[0]);if(!route)throw new Error('请选择有效路径');b.options.lettersInput=createLettersInput(ctx.context,route)}
   b.options.templateCatalog=db.letterResources.templates.map(({history,...t})=>structuredClone(t));b.options.validationResources=db.letterResources;
   task=createLettersTask(ctx.context,b,await assetsOnDisk());for(const l of task.result.letters)l.routeId=task.routeIds[0];
  }else task=createDesignTask(ctx.context,b,mode);
  task.contextId=b.contextId;if(mode==='llm')task.modelConfig=modelConfigSnapshot(snapshot);
  if(simulation){task.simulation={kind:'fictional-test',stage:'准备中',agreementIds:task.result.letters.flatMap(l=>l.agreementIds),confirmations:[]};task.status='running';task.startedAt=new Date().toISOString();task.progress='正在准备模拟流程';for(const l of task.result.letters){l.status='pending';l.bodyBlocks=[];l.text='等待模拟资料补全';l.simulation=true;}task.steps=[{name:'大模型补齐模拟资料'},{name:'创建模拟附件并检查'},{name:'大模型起草并检查'},{name:'自动模拟确认'},{name:'导出 Word / ZIP'}];}
  db.tasks[task.id]=task;await save();json(res,201,task);
  if(task.status==='running'){
   const generating=simulation?runSimulation(task,snapshot,{save,createAssets:(input,ids,notes)=>simulationAssets(input,ids,notes,task.templateCatalog),exportZip:t=>exportTask(t,{format:'zip'})}):b.agentType==='letters'?generateLetters(task,snapshot,save):generateDesign(task,ctx.context,snapshot,save);
   generating.catch(async()=>{task.status='failed';task.error='任务执行中断，请重新起草';task.finishedAt=new Date().toISOString();if(task.schemaVersion==='letters-v2'){for(const l of task.result.letters)if(['pending','generating','checking'].includes(l.status)){l.status='failed';l.error=task.error;l.bodyBlocks=[];l.text=task.error;l.live={...l.live,phase:'failed'};}refreshSummary(task);}await save()});
  }
  return;
 }
 const match=p.match(/^\/api\/v1\/tasks\/([A-Za-z0-9-]+)$/);if(match){const task=db.tasks[match[1]];if(!task)throw new Error('任务不存在');if(b.action==='status'){json(res,200,task);return}
  if(task.schemaVersion==='letters-v2'){
   if(task.status==='running')throw new Error('任务仍在生成，请稍后操作');
   if(b.action==='export'){json(res,200,await exportTask(task,b));return}
   if(task.simulation)throw new Error('模拟记录独立保存，不进行人工复核或修改；请返回真实资料编辑，或重新运行模拟流程');
   if(b.action==='record-correspondence'){recordCorrespondence(task,b);await save();json(res,200,task);return}
   if(b.action==='update-input'){updateLettersInput(task,b,await assetsOnDisk());for(const l of task.result.letters){validateRecipientReferences(l,task.input,task.input.agreements.find(a=>l.agreementIds.includes(a.id)),db.letterResources);if(l.missingFields.some(x=>x.blocking))l.status='blocked';}refreshSummary(task);await save();json(res,200,task);return}
   if(!['edit','confirm'].includes(b.action))throw new Error('不支持此操作');reviewLetter(task,b);
  }else{if(b.action!=='confirm')throw new Error('action 须为 status 或 confirm');confirmTask(task,b)}await save();json(res,200,task);return;
 }
 json(res,404,{error:{message:'接口不存在'}});
}catch(e){if(!res.headersSent)json(res,400,{error:{code:'VALIDATION_ERROR',message:e.message}});else res.end()}});
server.listen(port,'127.0.0.1',()=>process.stdout.write(`输电智能体后端：http://127.0.0.1:${port}\n协议征询函已接入模板生成、大模型、人工复核和 Word 导出\n`));
