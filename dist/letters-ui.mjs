import {templateManager,directoryManager,recipientRecommendations,correspondenceForm} from './letters-management.mjs';
import {createLettersInput,validateLettersInput,agreementSelectionSignature,LETTER_TEMPLATES,TYPE_LABELS} from './letters-core.mjs';
const $=s=>document.querySelector(s),esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let env,state,key,working=false,updating=false,active=0;
const watchers=new Map();
let followedUnit='';
function store(value=state,storageKey=key){localStorage.setItem(storageKey,JSON.stringify(value))}
function button(action,label,cls='',extra=''){return `<button class="${cls}" data-action="letter-ui" data-op="${action}" ${extra}>${label}</button>`}
function field(id,label,value='',type='text'){return `<label class="field"><span>${esc(label)}</span>${type==='textarea'?`<textarea id="${id}" rows="3">${esc(value)}</textarea>`:`<input id="${id}" type="${type}" value="${esc(value)}">`}</label>`}
function normalTask(){return env.tasks.find(t=>!state?.historyTaskIds?.includes(t.id)&&!t.simulation&&t.schemaVersion==='letters-v2'&&t.projectId===env.context.project.id&&t.projectVersion===env.context.project.version&&t.routeIds.includes(env.routeId))}
function chosenTask(){return state?.simulationView?env.tasks.find(t=>t.id===state.simulationView)||normalTask():normalTask()}
function selectedAgreements(){const ids=state.selected??state.input.agreements.filter(a=>a.status!=='已完成').map(a=>a.id);return state.input.agreements.filter(a=>ids.includes(a.id))}
function listConfirmed(){return state.listConfirmation?.signature===agreementSelectionSignature(state.input,selectedAgreements().map(a=>a.id))}
function confirmList(after){const selected=selectedAgreements();if(!selected.length)throw new Error('请先勾选协议事项');showForm('确认征询单位与事项清单',`<p>请核对收函单位正式全称、属地/区段、管理归属及征询事项。此确认不代表函件正文已复核。</p>${selected.map(a=>`<div class="checkcard"><b>${esc(a.unit||'单位未填写')}</b>${esc(a.scope)}<p>${esc(a.points)}</p></div>`).join('')}${field('list-reviewer','清单确认人员')}${field('list-note','确认依据 / 意见','','textarea')}<label class="checklabel"><input id="list-check" type="checkbox">已核对本次勾选单位、区段、事项及归属依据</label>`,async()=>{const reviewer=$('#list-reviewer').value.trim(),note=$('#list-note').value.trim();if(!reviewer||!note||!$('#list-check').checked)throw new Error('请填写人员和意见并勾选核对项');if(selected.some(a=>!a.unit.trim()||!a.scope.trim()||!a.points.trim()))throw new Error('请先补齐单位、区段和事项，再确认清单');state.listConfirmation={reviewer,note,at:new Date().toISOString(),signature:agreementSelectionSignature(state.input,selected.map(a=>a.id))};store();if(after)setTimeout(after,0)},'确认清单')}
function visibleLetters(t){
 if(t?.simulation)return t.result.letters;
 return selectedAgreements().map(a=>t?.result.letters.find(l=>l.agreementIds.includes(a.id))||{id:'NOT-GENERATED-'+a.id,agreementIds:[a.id],unit:a.unit||'单位待填写',status:'not_generated'});
}
function pendingPreview(l){return `<div class="letter-empty" role="status"><h2>${esc(l.unit)}</h2><span class="tag gray">尚未生成函件</span><p>已选中该协议事项。点击上方“生成正文 / 重新起草正文”起草，或从“更多操作”进入生成模板草稿、运行模拟流程。</p></div>`}
async function api(p,b,target=env){const r=await fetch((target.config.baseUrl||'http://127.0.0.1:4318').replace(/\/$/,'')+p,{method:b?'POST':'GET',headers:b?{'Content-Type':'application/json'}:undefined,body:b?JSON.stringify(b):undefined,signal:AbortSignal.timeout(p==='/api/v1/model-test'?200000:40000)});const v=await r.json();if(!r.ok)throw new Error(v.error?.message||'接口调用失败');return v}
function put(t,target=env){target.saveTask({...t,source:target.config.baseUrl||'http://127.0.0.1:4318'})}
const statusLabels={draft:'草稿待复核',incomplete:'资料待补充',needs_rewrite:'正文待重写',blocked:'资料阻断',failed:'生成或检查失败',pending:'排队等待',generating:'正文生成中',checking:'正文检查中',confirmed:'已人工复核',simulated:'已模拟确认'};
const inProgress=l=>['pending','generating','checking'].includes(l?.status);
const inputChanged=t=>t&&!t.simulation&&JSON.stringify(t.input)!==JSON.stringify(state.input);
export function preserveLettersMenu(render){
 const previous=$('.letter-more');
 const open=previous?.open,scrollTop=previous?.querySelector('.letter-more-menu')?.scrollTop||0;
 const focused=document.activeElement;
 const focusSummary=!!previous&&focused===previous.querySelector('summary');
 const focusOp=previous?.contains(focused)?focused?.dataset?.op:null;
 render();
 const current=$('.letter-more');if(!previous||!current)return;
 current.open=open;
 if(focusSummary)current.querySelector('summary')?.focus({preventScroll:true});
 else if(open&&focusOp){const item=[...current.querySelectorAll('[data-op]')].find(b=>b.dataset.op===focusOp);if(item&&!item.disabled)item.focus({preventScroll:true});}
 const panel=current.querySelector('.letter-more-menu');if(panel)panel.scrollTop=scrollTop;
}
function moreActions(disabled,simulation=false){
 const items=[
  ['recommend-recipients','匹配征询单位','按目录匹配线路区段，确认后加入协议清单。',disabled||(simulation?'disabled':'')],
  ['manage-directory','管理单位资料','导入和查看单位目录、行政区划及线路空间关系。',disabled],
  ['manage-templates','管理函件模板','新增、修改、启停模板，并查看历史版本。',disabled],
  ['xlsx','导出 Excel 台账','下载当前任务的函件、发出和回复记录台账。',disabled||(!chosenTask()?'disabled':'')],
  ['simulate','运行模拟流程','调用模型补齐模拟资料，完成起草、确认和导出。',disabled],
  ['run-template','生成模板草稿','按选定模板生成草稿，不调用大模型。',disabled]
 ];
 return `<details class="letter-more"><summary>更多操作<svg viewBox="0 0 16 16" aria-hidden="true"><path d="m4 6 4 4 4-4"/></svg></summary><div class="letter-more-menu">${items.map(([op,title,description,extra])=>(op==='simulate'?'<hr class="letter-more-divider">':'')+button(op,`<span class="letter-more-title">${esc(title)}</span><span class="letter-more-description">${esc(description)}</span>`,'letter-more-item',extra)).join('')}</div></details>`;
}
function syncNotice(t,changed,busy){
 const error=state.syncError?.taskId===t?.id?state.syncError:null;
 if(!t||t.simulation||(!changed&&!error))return '';
 if(updating)return '<div class="notice letter-sync-notice" role="status">正在同步资料与缺项检查…</div>';
 return `<div class="notice letter-sync-notice" role="${error?'alert':'status'}"><div><b>${error?'资料同步失败':'当前函件有资料待同步'}</b><p>${error?esc(error.message):'当前函件仍使用之前的资料，请同步后继续复核或导出。'} 本次操作不会调用大模型。</p></div>${button('sync',error?'重试更新':'同步资料','small',busy?'disabled':'')}</div>`;
}
function elapsed(start,end){const seconds=Math.max(0,Math.floor(((end?Date.parse(end):Date.now())-Date.parse(start))/1000)||0);return seconds<60?seconds+' 秒':Math.floor(seconds/60)+' 分 '+seconds%60+' 秒';}
function livePanel(t){
 if(t?.status!=='running')return '';
 const l=t.result.letters.find(x=>x.id===t.currentLetterId);
 const phase={waiting:l?.live?.stream?'等待模型返回正文':'等待模型返回（当前未启用流式接收）',thinking:'模型正在思考，等待正文',writing:'正在接收正文',checking:'正在检查正文结构与事实引用'}[l?.live?.phase]||'正在准备生成';
 return `<div class="letter-live" role="status"><div><b>当前单位：${esc(t.currentUnit||'准备中')}</b><span class="timer">已等待 ${elapsed(t.startedAt||t.createdAt)}</span></div><p>${esc(t.simulation?t.progress:phase)} · 已完成 ${t.result.letters.filter(x=>!inProgress(x)).length} / ${t.result.letters.length} 份</p><small>${t.simulation?'模拟阶段：'+esc(t.simulation.stage)+'。模型补全及正文检查通过后自动模拟确认。':'生成中的文字为预览，完整输出通过检查后才可复核。'}</small></div>`;
}
function letterPreview(t,l,busy,changed){
 const canEdit=!t.simulation&&['draft','confirmed','incomplete','needs_rewrite'].includes(l.status);
 const exportable=(t.simulation?t.status==='simulation_completed'&&l.status==='simulated':['draft','confirmed'].includes(l.status))&&!l.needsRewrite;
 const preview=inProgress(l)||l.status==='failed';
 return `<div class="letter-status"><span class="tag ${l.status==='confirmed'?'':'amber'}">${esc(statusLabels[l.status]||l.status)}</span><span>修订 ${l.revision} · ${esc(l.template)}${t.simulation?'':' · '+esc(l.correspondence?.state||'未发出')}</span></div>
 ${l.correspondence?.sentRevision&&l.correspondence.sentRevision!==l.revision?`<div class="notice">发出记录对应修订 ${l.correspondence.sentRevision}，当前为修订 ${l.revision}。历史发出/回复状态保留，请核对是否需重新征询。</div>`:''}
 ${l.error?`<div class="letter-error" role="alert"><b>生成或检查失败</b><p>${esc(l.error)}</p><small>本次输出未采用，请修正原因后点击“重新起草正文”。</small></div>`:''}
 ${l.status==='needs_rewrite'?'<div class="notice">路径、征询事项或专项资料已修改。下方保留原正文供参考，请点击“重新起草正文”，或通过“编辑正文”人工修订后重新复核。</div>':''}
 ${preview?`<div class="letter-preview-label">${l.status==='failed'?'未采用的正文预览':'实时正文预览 · 尚未通过完整检查'}</div>`:''}
 <pre class="letter-paper ${preview?'letter-paper-live':''}">${esc(preview?(l.previewText||l.error||'等待正文返回…'):l.text)}</pre>
 <div class="actions">${t.simulation?'':button('edit','编辑正文','',!canEdit||busy||changed?'disabled':'')}${t.simulation?'':button('confirm','人工复核','primary',t.simulation||!['draft','incomplete'].includes(l.status)||busy||changed?'disabled':'')}${t.simulation?'':button('correspondence','发出 / 回复记录','',busy||changed?'disabled':'')}${button('docx','下载本函 Word','',!exportable||busy||changed?'disabled':'')}${button('zip','下载批量 ZIP','',busy||changed||(t.simulation?t.status!=='simulation_completed':t.result.letters.some(x=>!['draft','confirmed'].includes(x.status)||x.needsRewrite))?'disabled':'')}</div>
 ${!t.simulation&&visibleLetters(t).filter(x=>x.status!=='not_generated').length<t.result.letters.length?`<p class="muted">批量 ZIP 包含当前任务全部 ${t.result.letters.length} 份函件。</p>`:''}
 ${l.status==='incomplete'?`<p class="muted">还有 ${l.missingFields.length} 项资料待补充，点击“人工复核”查看补充入口。日期、联系人和附件保存后直接更新，无需重新起草。</p>`:''}`;
}
export function renderLetters(e){
 env=e;const k='tx-letters-v2-'+e.context.project.id+'-'+e.context.project.version+'-'+e.routeId;
 if(key!==k){key=k;active=0;followedUnit='';try{state=JSON.parse(localStorage.getItem(key))}catch{state=null}if(!state?.input||state.input.route.id!==e.routeId){state={input:createLettersInput(e.context,e.context.routes.find(r=>r.id===e.routeId)),selected:null}}}
 const t=chosenTask(),input=t?.simulation?{...t.input,agreements:t.input.agreements.filter(a=>t.simulation.agreementIds.includes(a.id))}:state.input,ls=visibleLetters(t);
 if(t?.status==='running'&&t.currentLetterId&&followedUnit!==t.id+':'+t.currentLetterId){followedUnit=t.id+':'+t.currentLetterId;active=Math.max(0,ls.findIndex(x=>x.id===t.currentLetterId));}
 if(active>=ls.length)active=0;
 const l=ls[active],selected=t?.simulation?t.simulation.agreementIds:selectedAgreements().map(a=>a.id),busy=working||updating||t?.status==='running',disabled=busy?'disabled':'',changed=inputChanged(t);
 if(t?.status==='running')watchTask(t,e);
 return `<div class="pagehead"><div><div class="eyebrow">CORRESPONDENCE AGENT / 04</div><h1>协议征询函</h1><div class="subtitle">从平台协议清单到可复核的函件与附件包</div></div><div class="actions">${e.routeSelect}${t?.simulation?button('real-view','返回真实资料','',disabled):button('input','编辑输入资料','',disabled)}${t?.simulation?'':button('reset-input','重置','',disabled)}${button('run-llm',busy&&t?.status==='running'?(t.simulation?'模拟流程运行中…':'正文生成中…'):t&&!t.simulation?'重新起草正文':'生成正文','primary',busy||t?.simulation?'disabled':'')}${moreActions(disabled,!!t?.simulation)}</div></div>${e.projectBar}
 ${syncNotice(t,changed,busy)}
 ${t?.simulation?`<div class="notice letter-simulation" role="status"><b>模拟测试 · ${esc(t.simulation.stage)}</b><p>在独立副本中补齐资料，默认模板适用，自动模拟确认；未经人工复核，不可正式发文。测试附件为文字占位文件。真实输入与任务保持原样。</p>${t.error?`<p class="error-msg">${esc(t.error)}</p>`:''}${t.simulation.filledFields?.length?`<details><summary>查看模型补齐的 ${t.simulation.filledFields.length} 项资料</summary><ul>${t.simulation.filledFields.map(f=>`<li>${esc(f.label)}：${esc(f.value)}</li>`).join('')}</ul></details>`:''}${t.simulation.export?'<p>成果已打包，可点击下方“下载批量 ZIP”，包内包含各单位 Word 和模拟附件。</p>':''}</div>`:''}
 ${input.project.isDemo&&!t?.simulation?'<div class="notice">当前使用演示工程。请核对工程描述、收函单位、联系人和附件；可新增实际单位，历史样例中的批复与印章不会带入。</div>':''}
 ${livePanel(t)}
 <div class="letter-workspace"><section class="panel letter-agreements-panel"><div class="panel-head letter-agreements-head"><b class="letter-agreements-title">协议事项 · ${input.agreements.length}</b>${t?.simulation?'':`<div class="letter-agreements-tools">${button('confirm-list','确认清单','small',disabled)}${button('add','＋ 新增','small',disabled)}</div>`}</div><div class="bodypad">${t?.simulation?'<p class="muted">下方展示模拟副本中的单位，点击“返回真实资料”恢复编辑。</p>':''}${input.agreements.map((a,i)=>`<div class="letter-agreement"><label class="checklabel"><input type="checkbox" data-action="letter-ui" data-op="select" data-id="${esc(a.id)}" ${selected.includes(a.id)?'checked':''} ${busy||t?.simulation?'disabled':''}><b>${esc(a.unit||'单位待填写')}</b></label><small>${esc(TYPE_LABELS[a.type])} · ${esc(a.status)}<br>${esc(a.scope)}</small><div class="actions">${t?.simulation?'':button('agreement','编辑','small',`data-index="${i}" ${disabled}`)}${t?.simulation?'':button('attachments','附件','small',`data-index="${i}" ${disabled}`)}${t?.simulation?'':button('remove-agreement','删除','small',`data-id="${esc(a.id)}" ${disabled}`)}</div></div>`).join('')}<div class="actions">${t?.simulation?'':button('json','JSON 输入 / 导入','small',disabled)}${button('download-input','下载输入 JSON','small')}</div><p class="muted">可用一般、河道、公路、压矿、民航五类模板；不限于演示单位。</p></div></section>
 <section class="panel letter-preview"><div class="panel-head"><b>函件预览</b><div class="letter-preview-tools">${ls.length?`<span class="tag">已选 ${ls.length} 项 · 已生成 ${ls.filter(x=>['draft','incomplete','needs_rewrite','confirmed','simulated'].includes(x.status)).length} 份</span>`:'<span class="tag gray">未选择单位</span>'}${t?button('refresh','刷新任务状态','small'):''}</div></div><div class="bodypad letter-preview-body">${ls.length?`<div class="letter-tabs" role="group" aria-label="选择函件">${ls.map((x,i)=>button('tab',esc(x.unit),'small '+(i===active?'primary':''),`data-index="${i}"`)).join('')}</div>${l.status==='not_generated'?pendingPreview(l):letterPreview(t,l,busy,changed)}`:`<div class="letter-empty"><h2>尚未勾选协议事项</h2><p>请在左侧勾选单位，查看对应函件或准备起草。</p></div>`}</div></section>
 <section class="panel"><div class="panel-head"><b>资料检查与复核记录</b></div><div class="bodypad">${l&&l.status!=='not_generated'?`<p>协议编号：${esc(l.agreementIds.join('、'))}<br>路径：${esc(input.route.id)} · ${esc(t.projectVersion)}</p>${l.missingFields.length?`<span class="tag amber">${l.missingFields.length} 项待补充</span><ul class="letter-missing">${l.missingFields.map(x=>`<li>${esc(x.label)}${x.blocking?'（阻断生成）':''}</li>`).join('')}</ul><p class="muted">修改信息或上传附件后直接更新检查结果；正文事实发生变化时会提示重写。</p>`:inProgress(l)?'<span class="tag amber">资料已齐，正文仍在生成或检查</span>':l.status==='failed'?'<span class="tag amber">正文未通过生成或检查，请查看失败原因</span>':l.status==='needs_rewrite'?'<span class="tag amber">资料已更新，正文待重写或人工修订</span>':l.status==='simulated'?'<span class="tag">检查通过，已模拟确认（未经人工复核）</span>':l.status==='confirmed'?'<span class="tag">已人工复核</span>':'<span class="tag">检查通过，可提交人工复核</span>'}${(l.validationChecks||[]).map(c=>`<p class="muted">${esc(c.field)} · ${c.status==='passed'?'目录匹配通过':c.status==='failed'?'检查失败':'需人工核对'}<br>${esc(c.detail)}</p>`).join('')}${l.recipientEvidence?`<details><summary>收函单位确认依据</summary><p>${esc(l.recipientEvidence.evidence)}<br>${esc(l.recipientEvidence.basis)}<br>${esc(l.recipientEvidence.confirmedBy)} · ${esc(l.recipientEvidence.confirmedAt)}</p></details>`:''}${l.warnings.map(w=>`<p class="notice">${esc(w)}</p>`).join('')}<hr><p><b>生成记录</b><br>${esc(l.generation.model||(t.mode==='llm'?'等待模型完成':'固定模板'))}<br>${esc(l.generation.at||t.createdAt)}</p>${t.simulation?.confirmations?.filter(c=>c.letterId===l.id).map(c=>`<div class="checkcard"><b>自动模拟确认</b>${esc(c.note)}<small>${esc(c.at)}</small></div>`).join('')||''}${l.confirmations.map(c=>`<div class="checkcard"><b>${esc(c.reviewer)} · 修订 ${c.revision}</b>${esc(c.note)}<small>${esc(c.at)}${l.status!=='confirmed'||c!==l.confirmations.at(-1)?' · 历史记录，当前版本需重新复核':''}</small></div>`).join('')}`:l?`<p>当前单位：${esc(l.unit)}</p><p>该单位尚未生成函件，起草后显示资料检查与复核记录。</p>`:'<p>勾选协议事项后，查看对应单位的资料检查与复核记录。</p>'}<p class="muted">${t?.simulation?'模拟参数由模型补齐，附件为测试文字文件；原始输入不会被覆盖。':'数值直接引用输入；实际图纸和坐标表保存在本机后端，打包时原样附入。'}</p></div></section></div>`;
}
async function syncInput({refresh=false}={}){
 const target=env,local=state,storageKey=key;store(local,storageKey);let t=chosenTask();if(!t){delete local.syncError;store(local,storageKey);target.toast('输入资料已保存');return;}
 if(t.status==='running')throw new Error('正在生成正文，请结束后更新资料');
 const input=structuredClone(local.input);
 updating=true;target.render();
 try{
  validateLettersInput(input,{allowEmpty:true});
  if(refresh){t=await api('/api/v1/tasks/'+t.id,{action:'status'},target);put(t,target);}
  const updated=await api('/api/v1/tasks/'+t.id,{action:'update-input',expectedRevision:t.revision,lettersInput:input},target);put(updated,target);delete local.syncError;store(local,storageKey);
  target.toast(updated.result.letters.some(l=>l.status==='needs_rewrite')?'资料已更新，正文事实已变化，请重新起草或人工修订':'资料与缺项检查已更新，未调用大模型');
 }
 catch(error){local.syncError={taskId:t.id,message:error.message};store(local,storageKey);throw error;}
 finally{updating=false;target.render();}
}
function watchTask(task,target){
 if(watchers.has(task.id))return watchers.get(task.id);
 const follow=(async()=>{
  let t=task;
  try{while(t.status==='running'){
   await new Promise(r=>setTimeout(r,750));
   t=await api('/api/v1/tasks/'+task.id,{action:'status'},target);put(t,target);target.render();
  }return t;}catch(e){target.toast('任务状态更新失败：'+e.message+'。请点击“刷新任务状态”重试。');return null;}
  finally{watchers.delete(task.id);}
 })();watchers.set(task.id,follow);return follow;
}

function showForm(title,html,onSave,saveLabel='保存'){env.modal(title,html+'<div id="letter-error" class="error-msg" role="alert"></div>',`<button data-action="close">取消</button><button id="letter-save" class="primary">${esc(saveLabel)}</button>`,true);$('#letter-save').onclick=async()=>{try{$('#letter-save').disabled=true;await onSave();store();$('#dialog').close();env.render()}catch(e){$('#letter-error').textContent=e.message;$('#letter-save').disabled=false}}}
function editInput(){const p=state.input.project,r=state.input.route;showForm('工程与发函信息',`<p>工程名称和路径编号来自当前快照；日期、联系人和附件保存后直接更新；工程概况或路径描述变化时，需重新起草或人工修订正文。</p><div class="field-row">${field('li-issuer','发函单位',p.issuer)}${field('li-date','发函日期',p.issueDate,'date')}${field('li-number','发文字号（可选）',p.documentNumber)}</div><div class="field-row">${field('li-contact','联系人',p.contactName)}${field('li-phone','联系电话',p.contactPhone)}</div>${field('li-address','复函地址',p.replyAddress)}${field('li-overview','工程概况',p.overview,'textarea')}${field('li-route','本次路径描述',r.summary,'textarea')}<label class="checklabel"><input id="li-template" type="checkbox" ${state.input.templateConfirmed?'checked':''}>已人工核对参考模板结构，适用于本次征询</label>`,async()=>{Object.assign(p,{issuer:$('#li-issuer').value,issueDate:$('#li-date').value,documentNumber:$('#li-number').value,contactName:$('#li-contact').value,contactPhone:$('#li-phone').value,replyAddress:$('#li-address').value,overview:$('#li-overview').value});r.summary=$('#li-route').value;state.input.templateConfirmed=$('#li-template').checked;await syncInput()})}
async function editAgreement(i,{isNew=false}={}){const a=isNew?{id:'AGR-'+crypto.randomUUID(),unit:'',type:'general',scope:'',points:'',status:'未发函',round:'first',facts:{},attachments:[]}:structuredClone(state.input.agreements[i]);const originalType=a.type;const resources=await api('/api/v1/letter-resources'),tpl=resources.templates.find(t=>t.id===(a.templateId||a.type))||LETTER_TEMPLATES.find(t=>t.id===a.type);showForm(isNew?'新增协议事项':'编辑协议事项',`${field('la-unit','收函单位正式全称',a.unit)}<div class="field-row"><label class="field"><span>函件类型（保存后显示专项字段）</span><select id="la-type">${LETTER_TEMPLATES.map(t=>`<option value="${t.id}" ${a.type===t.id?'selected':''}>${t.name}</option>`).join('')}</select></label><label class="field"><span>完成情况</span><select id="la-status">${['未发函','已发函待复函','已完成'].map(s=>`<option ${a.status===s?'selected':''}>${s}</option>`).join('')}</select></label><label class="field"><span>征询轮次</span><select id="la-round">${[['first','首次'],['repeat','再次征询'],['revised','路径调整后重新征询']].map(([v,s])=>`<option value="${v}" ${a.round===v?'selected':''}>${s}</option>`).join('')}</select></label></div><label class="field"><span>采用模板（新任务使用当前版本）</span><select id="la-template"><option value="" ${!a.templateId?'selected':''}>按单位与协议类型自动匹配</option>${resources.templates.filter(t=>t.type===a.type&&(t.enabled||t.id===a.templateId)).map(t=>`<option value="${esc(t.id)}" ${(a.templateId||a.type)===t.id?'selected':''}>${esc(t.name)} v${esc(t.version)}${t.enabled?'':'（已停用，请更换）'}</option>`).join('')}</select></label><label class="field"><span>绑定收函单位目录（可选）</span><select id="la-authority"><option value="">手工填写，需人工核对</option>${resources.authorities.filter(x=>x.types.includes(a.type)).map(x=>`<option value="${esc(x.id)}" ${a.authorityId===x.id?'selected':''}>${esc(x.unit)}</option>`).join('')}</select></label>${field('la-areas','行政区划代码（可选，多个用逗号分隔）',(a.adminAreaCodes||[]).join(','))}${field('la-scope','行政区域 / 区段',a.scope)}${field('la-points','征询事项',a.points,'textarea')}<h3>${tpl.name} · 专项资料</h3><div class="letter-facts">${tpl.required.map(([k,n])=>field('lf-'+k,n,a.facts[k]??'',/M$|Deg$/.test(k)?'number':'text')).join('')||'<p>此类模板无统一专项数值要求，可在征询事项中补充本次内容。</p>'}</div>${field('la-reply','回函关键内容（原协议台账，可选）',a.replySummary,'textarea')}${field('la-history','前次函件与意见（再次、重新征询必填）',a.previousLetter,'textarea')}${field('la-change','本次路径调整原因（重新征询必填）',a.changeSummary,'textarea')}`,async()=>{a.unit=$('#la-unit').value;a.scope=$('#la-scope').value;a.points=$('#la-points').value;a.round=$('#la-round').value;a.status=$('#la-status').value;a.replySummary=$('#la-reply').value;a.previousLetter=$('#la-history').value;a.changeSummary=$('#la-change').value;for(const [k] of tpl.required){const v=$('#lf-'+k).value;a.facts[k]=/M$|Deg$/.test(k)&&v!==''?Number(v):v}a.type=$('#la-type').value;a.templateId=a.type===originalType?$('#la-template').value:'';a.authorityId=$('#la-authority').value;a.adminAreaCodes=$('#la-areas').value.split(/[,，\n]/).map(v=>v.trim()).filter(Boolean);if(isNew&&!a.unit.trim())throw new Error('请填写收函单位正式全称');const exists=state.input.agreements.some(x=>x.id===a.id),selected=selectedAgreements().map(x=>x.id);const candidate={...state.input,agreements:exists?state.input.agreements.map(x=>x.id===a.id?a:x):[...state.input.agreements,a]};validateLettersInput(candidate);state.input=candidate;if(isNew){state.selected=[...new Set([...selected,a.id])];delete state.listConfirmation;}await syncInput()},isNew?'确认新增':'保存');$('#la-authority').onchange=()=>{const authority=resources.authorities.find(x=>x.id===$('#la-authority').value);if(authority){$('#la-unit').value=authority.unit;$('#la-areas').value=authority.areaCodes.join(',')}};if(isNew)document.activeElement?.blur()}
async function attachments(i,replaceIndex=null){const a=state.input.agreements[i];env.modal('实际附件 · '+esc(a.unit),`<p>单文件最大 10MB。图纸和坐标表以原件加入成果包；当前不自动解析 DWG 或推算 GIS 参数。</p><div id="attachment-list">${a.attachments.map((x,j)=>`<div class="letter-agreement">${esc(x.kind)} / ${esc(x.name)}<br><small>${x.assetId?'已上传至本机后端':'尚未上传实际文件'} · ${esc(x.routeVersion)}</small><div class="actions">${button('replace-asset','替换文件','small',`data-index="${i}" data-asset="${j}"`)}${button('remove-asset','移除','small',`data-index="${i}" data-asset="${j}"`)}</div></div>`).join('')}</div><p class="muted">${replaceIndex===null?'上传并关联后会直接更新函件附件和缺项检查。':'正在替换：'+esc(a.attachments[replaceIndex]?.name)}，不会重新调用大模型。</p><label class="field"><span>附件类型</span><select id="asset-kind">${['路径图','坐标表','航带图','平断面图','杆塔坐标高程表','其他'].map(x=>`<option ${x===a.attachments[replaceIndex]?.kind?'selected':''}>${x}</option>`).join('')}</select></label><label class="field"><span>选择文件</span><input id="asset-file" type="file" accept=".pdf,.docx,.doc,.xlsx,.xls,.csv,.txt,.png,.jpg,.jpeg,.dwg,.dxf"></label><div id="letter-error" class="error-msg"></div>`,`<button data-action="close">关闭</button><button id="asset-upload" class="primary">上传并关联</button>`,true);$('#asset-upload').onclick=async()=>{try{const file=$('#asset-file').files[0];if(!file)throw new Error('请选择实际文件');if(file.size>10*1024*1024)throw new Error('单文件最大 10MB');$('#asset-upload').disabled=true;const bytes=new Uint8Array(await file.arrayBuffer());let binary='';for(let start=0;start<bytes.length;start+=32768)binary+=String.fromCharCode(...bytes.subarray(start,start+32768));const data=await api('/api/v1/assets',{name:file.name,base64:btoa(binary)}),kind=$('#asset-kind').value;const slot=replaceIndex===null?a.attachments.find(x=>x.kind===kind&&!x.assetId):a.attachments[replaceIndex];const val={name:file.name,kind,assetId:data.id,routeVersion:state.input.project.version};if(slot)Object.assign(slot,val);else a.attachments.push(val);await syncInput();attachments(i)}catch(e){$('#letter-error').textContent=e.message;$('#asset-upload').disabled=false}}}

async function run(mode,simulation=false){
 if(working||updating||chosenTask()?.status==='running')return;
 if(mode==='llm'&&!simulation&&!listConfirmed())return confirmList(()=>run(mode));
 const target=env,local=state,storageKey=key,input=structuredClone(state.input),agreementIds=state.selected||input.agreements.filter(a=>a.status!=='已完成').map(a=>a.id);
 try{validateLettersInput(input);if(!agreementIds.length)throw new Error('至少选择一个协议事项');working=true;target.render();
  const c=await api('/api/v1/context',target.context,target);
  const t=await api('/api/v1/tasks',{contextId:c.contextId,agentType:'letters',routeIds:[target.routeId],options:{mode,lettersInput:input,agreementIds,...(!simulation&&mode==='llm'?{requireListConfirmation:true,listConfirmation:local.listConfirmation}:{}),...(simulation?{simulation:true}:{})}},target);
  if(simulation)local.simulationView=t.id;else delete local.simulationView;store(local,storageKey);put(t,target);active=0;target.render();
  const result=t.status==='running'?await watchTask(t,target):t;
  if(result)target.toast(simulation?(result.status==='simulation_completed'?'模拟流程已完成，可下载 Word / ZIP':result.progress||'模拟流程失败'):result.result.letters.some(l=>l.status==='failed')?'生成或检查失败，请查看具体原因':result.result.letters.some(l=>l.missingFields.length)?'正文已生成，仍有资料待补充':'正文与资料检查通过，请人工复核');
 }catch(e){target.toast(e.message)}finally{working=false;target.render()}
}

export async function handleLetters(b){try{const op=b.dataset.op,i=Number(b.dataset.index),t=chosenTask(),l=visibleLetters(t)[active];
 if((working||updating||t?.status==='running')&&!['tab','refresh','download-input'].includes(op))throw new Error('任务正在处理，请稍后操作');
 if(op==='confirm-list')return confirmList();
 if(op==='manage-templates')return await templateManager(env,api);
 if(op==='manage-directory')return await directoryManager(env,api,state.input);
 if(op==='real-view'){delete state.simulationView;store();active=0;env.render();return}
 if(op==='simulate')return await run('llm',true);
 if(t?.simulation&&!['refresh','tab','docx','zip','xlsx','download-input'].includes(op))throw new Error('请先返回真实资料；模拟结果单独保存');
 if(op==='recommend-recipients')return await recipientRecommendations(env,api,structuredClone(state.input),async additions=>{const fresh=additions.filter(a=>!state.input.agreements.some(x=>x.authorityId===a.authorityId&&x.recipientEvidence?.relationId===a.recipientEvidence?.relationId));const input={...state.input,agreements:[...state.input.agreements,...fresh]};validateLettersInput(input);state.input=input;state.selected=state.input.agreements.filter(x=>additions.some(a=>x.authorityId===a.authorityId&&x.recipientEvidence?.relationId===a.recipientEvidence?.relationId)).map(a=>a.id);active=0;await syncInput({refresh:true})});
 if(op==='reset-input')return showForm('重置当前路径资料',`<p>清空本次填写的信息、上传附件的关联和当前正文，恢复工程与协议事项的初始样例。</p><p>大模型配置不变；历史任务保留，旧输入会自动备份到本机浏览器。</p>`,async()=>{
  const resetAt=new Date().toISOString(),backupKey='tx-letters-reset-backup-'+crypto.randomUUID();
  const input=createLettersInput(env.context,env.context.routes.find(r=>r.id===env.routeId));
  const historyTaskIds=[...new Set([...(state.historyTaskIds||[]),...env.tasks.filter(task=>task.schemaVersion==='letters-v2'&&task.projectId===env.context.project.id&&task.projectVersion===env.context.project.version&&task.routeIds.includes(env.routeId)).map(task=>task.id)])];
  const fresh={input,selected:null,historyTaskIds,resetAt,backupKey};
  localStorage.setItem(backupKey,JSON.stringify({storageKey:key,resetAt,state}));
  store(fresh,key);state=fresh;active=0;followedUnit='';
  env.toast('已重置，初始样例已恢复');
 },'确认重置');
 if(op==='sync')return await syncInput({refresh:true});
 if(op==='input')return editInput();if(op==='agreement')return await editAgreement(i);if(op==='attachments')return attachments(i);if(op==='replace-asset')return attachments(i,Number(b.dataset.asset));
 if(op==='select'){
  if(!state.input.agreements.some(a=>a.id===b.dataset.id))throw new Error('协议事项不存在');
  const ids=selectedAgreements().map(a=>a.id),previous=l?.agreementIds;
  state.selected=b.checked?[...new Set([...ids,b.dataset.id])]:ids.filter(id=>id!==b.dataset.id);
  const next=visibleLetters(t),index=next.findIndex(x=>b.checked?x.agreementIds.includes(b.dataset.id):x.agreementIds.some(id=>previous?.includes(id)));
  active=Math.max(0,index);store();env.render();return;
 }

 if(op==='refresh'){put(await api('/api/v1/tasks/'+t.id,{action:'status'}));env.render();return}
 if(op==='tab'){if(Number.isInteger(i)&&i>=0&&i<visibleLetters(t).length)active=i;env.render();return}
 if(op==='add'){if(state.input.agreements.length>=30)throw new Error('协议事项最多30条，请先删除不需要的事项');return await editAgreement(null,{isNew:true})}
 if(op==='remove-agreement'){
  const id=b.dataset.id;
  if(!state.input.agreements.some(a=>a.id===id))throw new Error('协议事项不存在');
  const selected=selectedAgreements().map(a=>a.id);
  state.input.agreements=state.input.agreements.filter(a=>a.id!==id);
  state.selected=selected.filter(x=>x!==id);
  delete state.listConfirmation;
  const next=visibleLetters(t);active=Math.max(0,next.findIndex(x=>x.agreementIds.some(v=>l?.agreementIds.includes(v))));
  if(!t||!inputChanged(t))delete state.syncError;
  store();env.render();
  if(t?.input.agreements.some(a=>a.id===id))await syncInput();
  env.toast('协议事项已删除');return;
 }
 if(op==='remove-asset'){state.input.agreements[i].attachments.splice(Number(b.dataset.asset),1);await syncInput();return attachments(i)}
 if(op==='json')return showForm('函件输入 JSON',`<p>可粘贴平台映射后的 letters-v2 数据。工程编号、版本和路径须与当前快照一致。附件通过上传后获得 assetId。</p><textarea id="letters-json" class="codebox" style="width:100%;min-height:400px">${esc(JSON.stringify(state.input,null,2))}</textarea><label class="field"><span>或选择输入 JSON 文件</span><input id="letters-import" type="file" accept=".json"></label>`,async()=>{const f=$('#letters-import').files[0];if(f&&f.size>400000)throw new Error('输入 JSON 不能超过 400KB');const v=JSON.parse(f?await f.text():$('#letters-json').value);validateLettersInput(v);if(v.project.id!==env.context.project.id||v.project.version!==env.context.project.version||v.route.id!==env.routeId)throw new Error('请保持工程、版本和路径与当前快照一致');state.input=v;state.selected=null;await syncInput()});
 if(op==='download-input'){env.download('协议征询函输入.json',JSON.stringify(t?.simulation?t.input:state.input,null,2),'application/json');return}
 if(op.startsWith('run-'))return await run(op==='run-llm'?'llm':'template');
 if(op==='xlsx'){if(!t)throw new Error('请先生成一个任务，再导出台账');if(inputChanged(t))throw new Error('请先同步资料，再导出台账');return await downloadExport(t,'xlsx')}
 if(!l||l.status==='not_generated')throw new Error('请先为当前选中的单位生成函件');
 if(op==='edit'&&inputChanged(t))throw new Error('请先通过页面提示同步资料，再编辑正文');
 if(op==='edit')return showForm('编辑函件正文',`<p>每个段落之间空一行。参数表和附件仍由程序管理，修改正文后需要重新复核。</p><textarea id="letter-body" style="width:100%;min-height:360px">${esc(l.bodyBlocks.join('\n\n'))}</textarea>`,async()=>put(await api('/api/v1/tasks/'+t.id,{action:'edit',letterId:l.id,expectedRevision:l.revision,bodyBlocks:$('#letter-body').value.split(/\n\s*\n/).filter(s=>s.trim())})));
 if(['confirm','edit','docx','zip'].includes(op)&&inputChanged(t))throw new Error('请先通过页面提示同步资料，再复核或导出');
 if(op==='correspondence'){if(inputChanged(t))throw new Error('请先同步资料，再登记业务状态');return correspondenceForm(env,api,t,l,updated=>put(updated))}
 if(op==='confirm')return reviewDialog(t,l);
 if(op==='docx'||op==='zip')return await downloadExport(t,op,op==='docx'?l.id:undefined);
 }catch(e){env.toast(e.message)}}

async function downloadExport(t,format,letterId){env.toast('正在生成导出文件…');const file=format==='zip'&&t.simulation?.export?t.simulation.export:await api('/api/v1/tasks/'+t.id,{action:'export',format,...(letterId?{letterId}:{})});const r=await fetch((env.config.baseUrl||'http://127.0.0.1:4318')+file.url);if(!r.ok)throw new Error('下载失败');const u=URL.createObjectURL(await r.blob()),a=document.createElement('a');a.href=u;a.download=file.name;a.click();setTimeout(()=>URL.revokeObjectURL(u),5000);env.toast('导出完成')}

function reviewDialog(t,l){
 if(!['draft','incomplete'].includes(l.status))throw new Error('请先完成正文起草和检查');
 if(l.missingFields.length){
  const i=state.input.agreements.findIndex(a=>l.agreementIds.includes(a.id));
  const fields=l.missingFields.map(x=>x.field);
  const common=fields.some(x=>x.startsWith('project.')||x.startsWith('route.')||x==='templateConfirmed');
  const attachmentsMissing=fields.some(x=>x.startsWith('attachments.'));
  const agreementMissing=fields.some(x=>!x.startsWith('project.')&&!x.startsWith('route.')&&!x.startsWith('attachments.')&&x!=='templateConfirmed');
  return env.modal('人工复核 · '+esc(l.unit),`<p>当前函件还有 ${l.missingFields.length} 项资料待补充，暂不能提交复核确认。</p><ul class="letter-missing">${l.missingFields.map(x=>`<li>${esc(x.label)}</li>`).join('')}</ul><div class="actions">${common?button('input','补充工程与发函信息'):''}${i>=0&&agreementMissing?button('agreement','补充协议资料','',`data-index="${i}"`):''}${i>=0&&attachmentsMissing?button('attachments','上传或核对附件','',`data-index="${i}"`):''}</div><p class="muted">补齐日期、联系人或附件并保存后，资料检查会直接更新，无需调用大模型。检查通过后再点击“人工复核”填写人员、意见并确认。</p>`, '<button data-action="close">关闭</button><button class="primary" disabled>提交复核确认</button>',true);
 }
 return showForm('人工复核 · '+esc(l.unit),`<p>请核对收函单位、工程事实、专项数值、路径版本和实际附件。如需修改正文，请关闭此窗口后点击“编辑正文”。</p>${field('lr-name','复核人员')}${field('lr-note','复核意见','','textarea')}<label class="checklabel"><input id="lr-check" type="checkbox">我已核对本函正文、数值和实际附件</label>`,async()=>{
  if(!$('#lr-name').value.trim()||!$('#lr-note').value.trim())throw new Error('请填写复核人员和意见');
  if(!$('#lr-check').checked)throw new Error('请先勾选核对确认项');
  put(await api('/api/v1/tasks/'+t.id,{action:'confirm',letterId:l.id,expectedRevision:l.revision,reviewer:$('#lr-name').value,note:$('#lr-note').value}));
 },'提交复核确认');
}
