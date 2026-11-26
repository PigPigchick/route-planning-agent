import assert from 'node:assert/strict';
import {once} from 'node:events';
import {spawn,spawnSync} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {createServer} from 'node:net';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {setTimeout as pause} from 'node:timers/promises';
import {fileURLToPath} from 'node:url';
import {SAMPLE,clone} from './dist/engine.mjs';
import {rraDocumentKinds} from './dist/rra-reader.mjs';
import {findRraRuntime} from './backend/rra-runtime.mjs';

const root=path.dirname(fileURLToPath(import.meta.url));
const rraRoot=await findRraRuntime(root);
if(!rraRoot)throw new Error('请先运行 npm run setup:rra');
const folder=await mkdtemp(path.join(tmpdir(),'tx-rra-qa-'));
const python=process.env.TX_RRA_PYTHON||path.join(rraRoot,'.venv','bin','python');
const soffice=process.env.TX_RRA_TEST_SOFFICE;
const env={PATH:process.env.PATH,HOME:folder,TMPDIR:folder,PYTHONDONTWRITEBYTECODE:'1',MPLBACKEND:'Agg',MPLCONFIGDIR:path.join(folder,'mpl')};
const children=[];

async function freePort(){
 const server=createServer().listen(0,'127.0.0.1');
 await once(server,'listening');
 const {port}=server.address();
 await new Promise((resolve,reject)=>server.close(error=>error?reject(error):resolve()));
 return port;
}

async function start(executable,args,cwd,options,ready){
 const child=spawn(executable,args,{cwd,env:{...env,...options},stdio:['ignore','pipe','pipe']});
 const record={child,logs:''};children.push(record);
 child.once('error',error=>{record.error=error;});
 child.stdout.on('data',chunk=>record.logs+=chunk);
 child.stderr.on('data',chunk=>record.logs+=chunk);
 for(let i=0;i<100;i++){
  if(record.logs.includes(ready))return;
  if(record.error||child.exitCode!==null)break;
  await pause(100);
 }
 throw new Error('服务启动失败\n'+(record.error?.message||record.logs));
}

function kml(name,coordinates){
 const xml=`<kml><Placemark><LineString><coordinates>${coordinates}</coordinates></LineString></Placemark></kml>`;
 return {name,base64:Buffer.from(xml).toString('base64')};
}

try{
 const fixture=spawnSync(python,['-m','tests.studio_fixture',folder,...(soffice?[soffice]:[])],{cwd:rraRoot,env,encoding:'utf8'});
 assert.equal(fixture.status,0,fixture.error?.message||fixture.stderr);
 const rraPort=await freePort(),appPort=await freePort();
 const origin='http://127.0.0.1:'+appPort;
 const rraOrigin='http://127.0.0.1:'+rraPort;
 const pythonJobs=path.join(folder,'jobs');
 await start(python,['-m','road_description.service','--config',path.join(rraRoot,'configs','config.dapu-kml.example.json'),
  '--studio-projects',path.join(folder,'registry.json'),'--jobs',pythonJobs,'--port',String(rraPort)],rraRoot,{PYTHONUNBUFFERED:'1'},rraOrigin+'/api/health');
 const backendEnv={PORT:String(appPort),TX_DATA_DIR:path.join(folder,'state'),TX_RRA_BASE_URL:rraOrigin,TX_USE_DATABASE:'false',
  TX_DATABASE_URL:'',LLM_BASE_URL:'',LLM_MODEL:'',LLM_API_KEY:'',EMBEDDING_MODEL:'',EMBEDDING_BASE_URL:'',EMBEDDING_API_KEY:''};
 await start(process.execPath,['server.mjs'],root,backendEnv,'输电智能体后端');
 const post=async(endpoint,data,status=200)=>{
  const response=await fetch(origin+endpoint,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:AbortSignal.timeout(20000)});
  const body=await response.json();
  assert.equal(response.status,status,JSON.stringify(body));
  return body;
 };
 const context=clone(SAMPLE);
 Object.assign(context.project,{id:'RRA-INTEGRATION',version:'v1',name:'RRA 集成联调样例'});
 const {contextId}=await post('/api/v1/context',context,201);
 const [upper,lower]=context.routes;
 const payload={contextId,agentType:'comparison',routeIds:[upper.id,lower.id],options:{engine:'rra',
  north:kml('north.kml','0,0,0 .005,.004,0 .012,0,0'),south:kml('south.kml','.012,0,0 .005,.001,0 0,0,0')}};
 await post('/api/v1/tasks',{...payload,options:{...payload.options,south:payload.options.north}},400);
 const wrongVersion=clone(context);wrongVersion.project.version='v2';
 const other=await post('/api/v1/context',wrongVersion,201);
 const denied=await post('/api/v1/tasks',{...payload,contextId:other.contextId},400);
 assert.match(denied.error.message,/尚未配置此工程版本/);
 let task=await post('/api/v1/tasks',payload,201);
 assert.equal(task.schemaVersion,'rra-v1');
 assert.equal(task.status,'running');
 const resource='/api/v1/tasks/'+task.id;
 for(let n=0;n<180&&task.status==='running';n++){
  await pause(1000);
  task=await post(resource,{action:'status'});
 }
 if(task.status!=='awaiting_confirmation'){
  const log=await readFile(path.join(pythonJobs,task.externalId,'output','workflow.log'),'utf8').catch(()=> '');
  throw new Error(JSON.stringify(task.result)+'\n'+log);
 }
 assert.deepEqual(task.result.metrics.map(metric=>metric.routeId),[upper.id,lower.id]);
 assert.ok(task.result.metrics.every(metric=>metric.km>1&&/^[0-9a-f]{64}$/.test(metric.geometryHash)));
 const files=task.result.files;
 assert.equal(files.filter(file=>file.name.endsWith('.docx')).length,5);
 if(soffice)assert.equal(files.filter(file=>file.name.endsWith('.pdf')).length,5);
 for(const file of files){
  const response=await fetch(origin+file.url);
  assert.equal(response.status,200);
  assert.match(response.headers.get('content-disposition'),/^attachment;/);
  const bytes=Buffer.from(await response.arrayBuffer());
  assert.ok(bytes.length>1000);
  assert.ok(bytes.subarray(0,4).toString().startsWith(file.name.endsWith('.docx')?'PK':'%PDF'));
 }
 assert.equal((await fetch(origin+resource+'/rra-files/999')).status,404);
 await post(resource,{action:'confirm'},400);

 const documents=resource+'/rra-document/';
 assert.deepEqual(rraDocumentKinds(task,'description',upper.id),['description']);
 assert.deepEqual(rraDocumentKinds(task,'comparison',upper.id),['comparison','assembly']);
 assert.deepEqual(rraDocumentKinds(task,'compliance',lower.id),['lower','upper']);
 for (const kind of ['description','comparison','upper','lower','assembly']) {
  const response=await fetch(origin+documents+kind+'/read');
  assert.equal(response.status,200,kind);
  const doc=await response.json();
  assert.ok(doc.blocks.some(block=>block.type==='paragraph'&&block.text.trim()),kind);
  assert.match(doc.source,/^[0-9a-f]{64}$/);
  assert.equal(doc.version,0);
 }
 const readPath=origin+documents+'description/read';
 const doc=await (await fetch(readPath)).json();
 const paragraph=doc.blocks.find(block=>block.type==='paragraph');
 const image=doc.blocks.find(block=>block.type==='image')?.file
  ||doc.blocks.find(block=>block.type==='table'&&block.rows.flat().some(cell=>cell.images.length))?.rows.flat().find(cell=>cell.images.length)?.images[0];
 assert.ok(image);
 const picture=await fetch(origin+documents+'description/image?name='+encodeURIComponent(image));
 assert.equal(picture.status,200);
 assert.match(picture.headers.get('content-type'),/^image\/(png|jpeg)/);
 assert.ok((await picture.arrayBuffer()).byteLength>100);
 assert.equal((await fetch(origin+documents+'description/image?name=unknown.png')).status,400);
 const edit={id:paragraph.id,source:doc.source,version:doc.version,text:'本段为联调样例，已完成文字核对。'};
 const savePath=documents+'description/save';
 await post(documents+'assembly/save',edit,405);
 const suggest=await post(documents+'description/suggest',{...edit,instruction:'精简表达'},503);
 assert.match(suggest.error.message,/尚未启用/);
 assert.deepEqual(await post(savePath,edit),{version:1});
 const conflict=await post(savePath,edit,409);
 assert.match(conflict.error.message,/已更新/);
 const audited=await (await fetch(readPath)).json();
 assert.equal(audited.version,1);
 assert.equal(audited.blocks.find(block=>block.id===paragraph.id).text,edit.text);
 const revisedWord=await fetch(origin+documents+'description/docx');
 assert.equal(revisedWord.status,200);
 assert.match(revisedWord.headers.get('content-disposition'),/^attachment;/);
 assert.equal(Buffer.from(await revisedWord.arrayBuffer()).subarray(0,2).toString(),'PK');
 if(soffice){
  const revisedPdf=await fetch(origin+documents+'description/pdf');
  assert.equal(revisedPdf.status,200);
  assert.equal(Buffer.from(await revisedPdf.arrayBuffer()).subarray(0,4).toString(),'%PDF');
 }
 const query='?'+new URLSearchParams({projectId:context.project.id,version:context.project.version});
 assert.deepEqual((await (await fetch(origin+'/api/v1/tasks'+query)).json()).tasks.map(it=>it.id),[task.id]);
 assert.deepEqual((await (await fetch(origin+'/api/v1/tasks?projectId=OTHER')).json()).tasks,[]);
 const backend=children.at(-1).child;
 backend.kill();await once(backend,'exit');
 await start(process.execPath,['server.mjs'],root,backendEnv,'输电智能体后端');
 assert.deepEqual((await post(resource,{action:'status'})).result.files,files);
 assert.equal((await (await fetch(readPath)).json()).version,1);
 console.log(`RRA 联调通过：双 KML 生成、五类文档在线读取与图件、审校保存及冲突检测、工程任务隔离、重启持久化，下载 ${files.length} 份原稿及审校成果。`);
}finally{
 await Promise.all(children.map(async({child})=>{
  if(child.exitCode!==null||child.signalCode!==null||!child.pid)return;
  child.kill();await once(child,'exit');
 }));
 await rm(folder,{recursive:true,force:true});
}
