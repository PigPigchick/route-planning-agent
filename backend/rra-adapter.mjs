import {createHash,randomUUID} from 'node:crypto';

const kmlLimit=2*1024*1024;
const readyStates=new Set(['completed','review_required']);
const runningStates=new Set(['queued','running','cancelling']);
const failedStates=new Set(['failed','interrupted','cancelled']);
const groupNames={description:'路径描述',comparison:'方案比选',compliance:'合规分析',assembly:'综合报告'};

function inputFile(value,label){
 if(typeof value?.name!=='string'||!/^([^/\\\x00-\x1f]{1,200})\.kml$/i.test(value.name)
  ||typeof value.base64!=='string'||value.base64.length>Math.ceil(kmlLimit/3)*4||!/^[A-Za-z0-9+/]+={0,2}$/.test(value.base64)){
  throw new Error(`请选择有效的${label} KML 文件（最大 2 MB）`);
 }
 const data=Buffer.from(value.base64,'base64');
 if(!data.length||data.length>kmlLimit||data.toString('base64')!==value.base64)throw new Error(`${label} KML 文件无效或超过 2 MB`);
 return {name:value.name,data,sourceSha256:createHash('sha256').update(data).digest('hex')};
}

function reportFiles(groups){
 return Object.entries(groupNames).flatMap(([key,label])=>(Array.isArray(groups?.[key])?groups[key]:[])
  .filter(name=>typeof name==='string'&&/\.(docx|pdf)$/i.test(name)
   &&name.split('/').every(part=>part&&part!=='.'&&part!=='..'&&!/[\\\x00-\x1f]/.test(part)))
  .map(path=>({path,name:path.split('/').at(-1),label})));
}

export function rraAdapter(baseUrl,{fetcher=fetch}={}){
 let origin;
 if(baseUrl){
  const url=new URL(baseUrl);
  if(url.protocol!=='http:'||!['127.0.0.1','localhost'].includes(url.hostname)||url.pathname!=='/'||url.username||url.password||url.search||url.hash)throw new Error('TX_RRA_BASE_URL 须为本机 HTTP 服务地址');
  origin=url.origin;
 }
 async function request(path,options={},timeout=15000){
  if(!origin)throw new Error('请先配置 RRA 工程地图并启动报告服务');
  try{return await fetcher(origin+path,{...options,signal:AbortSignal.timeout(timeout),redirect:'error'});}
  catch{throw new Error('无法连接本机 RRA 报告服务，请检查启动状态后重试');}
 }
 async function json(path,options){
  const response=await request(path,options);
  const data=await response.json().catch(()=>null);
  if(!response.ok||!data)throw new Error(typeof data?.error==='string'?data.error:'RRA 服务返回异常（HTTP '+response.status+'）');
  return data;
 }
 return {
  async submit(context,request){
   if(request.agentType!=='comparison'||!context.project.version||!Array.isArray(request.routeIds)
    ||request.routeIds.length!==2||request.routeIds[0]===request.routeIds[1]
    ||request.routeIds.some(id=>!context.routes.some(route=>route.id===id)))throw new Error('RRA 比选须选择同一工程版本下两条不同的候选路径');
   const north=inputFile(request.options?.north,'北方案'),south=inputFile(request.options?.south,'南方案');
   if(north.sourceSha256===south.sourceSha256)throw new Error('南北方案须上传不同的 KML 文件');
   const form=new FormData();
   form.set('projectId',context.project.id);
   form.set('projectVersion',context.project.version);
   form.set('upper',new Blob([north.data]),north.name);
   form.set('lower',new Blob([south.data]),south.name);
   const data=await json('/api/kml-jobs',{method:'POST',body:form});
   if(typeof data.id!=='string'||!/^[0-9a-f]{32}$/.test(data.id))throw new Error('RRA 未返回有效的任务编号');
   return {
    id:'TASK-'+randomUUID(),schemaVersion:'rra-v1',agentType:'comparison',contextId:request.contextId,
    projectId:context.project.id,projectVersion:context.project.version,routeIds:[...request.routeIds],externalId:data.id,
    routeBindings:[{id:'upper',routeId:request.routeIds[0],sourceSha256:north.sourceSha256},{id:'lower',routeId:request.routeIds[1],sourceSha256:south.sourceSha256}],
    mode:'rra',status:'running',revision:1,createdAt:new Date().toISOString(),confirmations:[],
    steps:[{name:'提交南北候选路径'},{name:'执行 GIS 计算与报告生成'},{name:'核对报告成果'}],
    result:{title:'RRA 双路径报告',phase:'queued',text:'RRA 已接收任务',files:[]}
   };
  },
  async refresh(task){
   const data=await json('/api/kml-jobs/'+task.externalId);
   if(data.id!==task.externalId||data.studioProject?.id!==task.projectId||data.studioProject?.version!==task.projectVersion
    ||task.routeBindings.some(binding=>!data.routes?.some(r=>r.id===binding.id&&r.sourceSha256===binding.sourceSha256)))throw new Error('RRA 返回的工程版本或路径与提交记录不一致');
   const phase=data.status;
   if(!runningStates.has(phase)&&!readyStates.has(phase)&&!failedStates.has(phase))throw new Error('RRA 返回未知任务状态');
   const metrics=(Array.isArray(data.summary)?data.summary:[]).flatMap(item=>{
    const binding=task.routeBindings.find(route=>route.id===item.id);
    return binding&&Number.isFinite(item.km)&&typeof item.geometryHash==='string'
     ?[{routeId:binding.routeId,km:item.km,geometryHash:item.geometryHash}]:[];
   });
   const files=readyStates.has(phase)?reportFiles(data.groups):[];
   const text=phase==='review_required'?'报告已生成，存在待审阅事项':phase==='completed'?'报告已生成，等待专业复核'
    :phase==='queued'?'报告任务排队中':phase==='running'?'正在计算空间关系并生成报告'
     :phase==='cancelling'?'正在取消报告任务':String(data.error||'RRA 报告任务未完成').slice(0,500);
   task.status=runningStates.has(phase)?'running':readyStates.has(phase)?'awaiting_confirmation':'failed';
   task.result={...task.result,phase,stage:typeof data.stage==='string'?data.stage:'',text,metrics,
    files:files.map((file,i)=>({...file,url:`/api/v1/tasks/${task.id}/rra-files/${i}`})),
    review:data.review?{status:data.review.status,blocking:data.review.blocking,failed:data.review.failed}:null};
   if(task.status==='failed')task.error=text;
  },
  async download(task,index){
   const file=task.result.files?.[index];
   if(!file)throw new Error('RRA 报告文件不存在');
   const target=file.path.split('/').map(encodeURIComponent).join('/');
   const response=await request(`/api/reports/${task.externalId}/files/${target}`);
   if(!response.ok||!response.body)throw new Error('RRA 报告文件暂不可用');
   return {file,response};
  },
  async document(task,kind,action,{image,payload}={}){
   if(!readyStates.has(task.result?.phase))throw new Error('请等待报告生成完成');
   if(!/^[0-9a-f]{32}$/.test(task.externalId))throw new Error('报告任务编号无效');
   const target=`/api/kml-jobs/${task.externalId}/document/${kind}/${action}`;
   if(action==='image'){
    if(!/^image\d+\.(?:png|jpe?g)$/i.test(image||''))throw new Error('报告图件名称无效');
    return request(target+'?name='+encodeURIComponent(image));
   }
   if(payload)return request(target,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)},action==='suggest'?120000:15000);
   return request(target,{},action==='pdf'?120000:15000);
  },
  async cancel(task){await json('/api/reports/'+task.externalId+'/cancel',{method:'POST'});}
 };
}
