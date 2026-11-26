const pathFor=task=>'/api/v1/tasks/'+encodeURIComponent(task.id);
const maxKmlSize=2*1024*1024;
const phases={loading:'读取工程地图',extracting_facts:'提取沿线事实',generating_figures:'生成图件',writing:'整理路径描述',
 rendering:'排版导出',running_agents:'计算方案比选与合规报告',reviewing_reports:'检查报告与依据'};

function encodeKml(file){
 if(!file||!/\.kml$/i.test(file.name)||!file.size||file.size>maxKmlSize)throw new Error('请选择非空 KML 文件，单份最大 2 MB');
 return new Promise((resolve,reject)=>{
  const reader=new FileReader();
  reader.onload=()=>resolve({name:file.name,base64:reader.result.split(',')[1]});
  reader.onerror=()=>reject(new Error('无法读取 '+file.name));
  reader.readAsDataURL(file);
 });
}

export function openRraForm({context,selected,esc,modal,request,remember,refreshView,toast}){
 const routes=context.routes;
 const choices=selected.length===2?selected:routes.slice(0,2).map(route=>route.id);
 const fields=['北方案','南方案'].map((label,i)=>`<fieldset class="rra-route"><legend>${label}</legend>
  <label class="field"><span>工程路径</span><select id="rra-route-${i}">${routes.map(route=>`<option value="${esc(route.id)}" ${route.id===choices[i]?'selected':''}>${esc(route.name)} (${esc(route.id)})</option>`).join('')}</select></label>
  <label class="field"><span>KML 文件</span><input type="file" id="rra-kml-${i}" accept=".kml,application/vnd.google-earth.kml+xml" required></label></fieldset>`).join('');
 modal('生成双路径报告',`<p>${esc(context.project.name)} · ${esc(context.project.version)}</p>
  <p>为两条候选路径分别上传 KML。两条线须使用相同起终点，并位于此工程的 GIS 地图范围内。</p>${fields}<p id="rra-form-error" class="error-msg" role="alert"></p>`,
  '<button data-action="close">取消</button><button class="primary" id="rra-create">提交生成</button>');
 const dialog=document.querySelector('#dialog'),button=dialog.querySelector('#rra-create'),errorLine=dialog.querySelector('#rra-form-error');
 button.onclick=async()=>{
  button.disabled=true;errorLine.textContent='';
  try{
   const routeIds=[0,1].map(i=>dialog.querySelector('#rra-route-'+i).value);
   if(routeIds[0]===routeIds[1])throw new Error('请选择两条不同的工程路径');
   const [north,south]=await Promise.all([0,1].map(i=>encodeKml(dialog.querySelector('#rra-kml-'+i).files[0])));
   const {contextId}=await request('/api/v1/context',context);
   const task=await request('/api/v1/tasks',{contextId,agentType:'comparison',routeIds,options:{engine:'rra',north,south}});
   remember(task);
   if(button.isConnected&&dialog.open)dialog.close();
   refreshView(task);
   toast('双路径报告任务已提交');
  }catch(error){errorLine.textContent=error.message;if(!button.isConnected||!dialog.open)toast(error.message);}
  finally{button.disabled=false;}
 };
}

export function rraPanel(task,{context,esc,config,error,refreshing,history,kinds}){
 const result=task?.result;
 const label=task?.status==='running'?'处理中':task?.status==='failed'?'未完成':result?'待专业复核':'尚未生成';
 const files=result?.files||[];
 const metrics=result?.metrics||[];
 const stage=task?.status==='running'&&phases[result?.stage];
 const base=(config.baseUrl||location.origin).replace(/\/$/,'');
 const taskLabel=item=>`${new Date(item.createdAt).toLocaleString('zh-CN',{hour12:false})} · ${item.status==='running'?'生成中':item.status==='failed'?'未完成':'已生成'}`;
 return `<section class="panel rra-panel" id="rra-report"><div class="panel-head"><div class="panel-title">RRA 双路径报告</div>
  <div class="rra-report-meta">${history.length?`<label><span>报告记录</span><select id="rra-history" aria-label="切换历史报告">${history.map(item=>
   `<option value="${esc(item.id)}" ${item.id===task?.id?'selected':''}>${esc(taskLabel(item))}</option>`).join('')}</select></label>`:''}
  <span class="tag ${task?.status==='running'?'blue':'gray'}">${label}</span></div></div>
  <div class="bodypad"><p>${esc(result?.text||'提交南北候选路径 KML，生成路径描述、方案比选和合规分析报告。')}</p>
  ${stage?`<p class="limittext">当前步骤 · ${esc(stage)}</p>`:''}
  ${metrics.length?`<ul>${metrics.map(metric=>`<li>${esc(context.routes.find(r=>r.id===metric.routeId)?.name||metric.routeId)} · ${esc(metric.km)} km</li>`).join('')}</ul>`:''}
  ${result?.review?`<p>报告审阅记录显示 ${esc(result.review.blocking||0)} 项阻断、${esc(result.review.failed||0)} 项检查未通过。</p>`:''}
  ${files.length?`<details class="rra-downloads"><summary>下载原始报告</summary><ul>${files.map((file,index)=>`<li><a href="${esc(base+pathFor(task)+'/rra-files/'+index)}" download>${esc(file.label)} · ${esc(file.name)}</a></li>`).join('')}</ul></details>`:''}
  ${kinds.length?'<div id="rra-reader" class="rra-reader"></div>':''}
  ${error?`<p class="error-msg" role="alert">${esc(error)}</p>`:''}
  ${task?.status==='running'&&config.mode!=='demo'?`<button data-action="rra-status" data-id="${esc(task.id)}" ${refreshing?'disabled':''}>查询进度</button>`:''}</div></section>`;
}

export const fetchRraStatus=(request,task)=>request(pathFor(task),{action:'status'});
