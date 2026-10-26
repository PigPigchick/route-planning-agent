import {LETTER_TEMPLATES} from '../dist/letters-core.mjs';
const types=LETTER_TEMPLATES.map(t=>t.id),tokens=new Set(['projectName','projectOverview','routeSummary','requestItems','specialFacts','historySummary']);
const text=(v,label,max=6000)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new Error(label+'不能为空或过长');return v.trim()};
const list=(v,label,max=100)=>{if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=='string'||!x.trim()||x.length>300))throw new Error(label+'须为有效文字数组');return [...new Set(v.map(x=>x.trim()))]};
export const DEFAULT_BODY=['{{projectOverview}}','{{routeSummary}}','{{specialFacts}}','{{historySummary}}','现就{{requestItems}}征询贵单位意见，请予指导并函复。','专此函达，请予支持。'];
export function createLetterResources(){return {revision:1,templates:LETTER_TEMPLATES.map(t=>({...structuredClone(t),type:t.id,enabled:true,bodyBlocks:[...DEFAULT_BODY],history:[]})),authorities:[],relations:[],areas:[],audit:[]};}
function templateValue(b,previous){
 const type=b.type||previous?.type;if(!types.includes(type))throw new Error('模板所属协议类型无效');
 if(previous&&type!==previous.type)throw new Error('已有模板不能更换协议类型，请新增模板');
 const base=LETTER_TEMPLATES.find(t=>t.id===type),required=b.required??previous?.required??base.required;
 if(!Array.isArray(required)||required.length>30||required.some(x=>!Array.isArray(x)||x.length!==2||typeof x[0]!=='string'||!/^[a-zA-Z][a-zA-Z0-9]{0,50}$/.test(x[0])||typeof x[1]!=='string'||!x[1].trim()||x[1].length>100))throw new Error('必填参数格式须为 [[字段名,显示名称]]');
 for(const [k] of base.required)if(!required.some(x=>x[0]===k))throw new Error('不能移除此类型的基础必填参数：'+k);
 const attachments=list(b.attachments??previous?.attachments??base.attachments,'附件要求',20);for(const a of base.attachments)if(!attachments.includes(a))throw new Error('不能移除基础附件要求：'+a);
 const body=b.bodyBlocks??previous?.bodyBlocks??DEFAULT_BODY;
 if(!Array.isArray(body)||body.length<3||body.length>12||body.some(x=>typeof x!=='string'||x.length>2000))throw new Error('模板正文须为3至12段，每段不超过2000字');
 const all=body.join('\n');for(const k of ['projectOverview','routeSummary','requestItems'])if(!all.includes('{{'+k+'}}'))throw new Error('模板缺少必要占位符：'+k);
 const stripped=all.replace(/\{\{(\w+)\}\}/g,(_,k)=>{if(!tokens.has(k))throw new Error('模板占位符无效：'+k);return ''});
 if(/[<>]|\d|已获.{0,5}同意|已.{0,3}批复|已批准|符合.{0,6}(要求|规范)/.test(stripped))throw new Error('模板连接文字不能硬编码数值、HTML或审批结论，请使用事实占位符');
 return {id:previous?.id||'TPL-'+crypto.randomUUID(),type,name:text(b.name,'模板名称',120),source:text(b.source,'模板来源',1000),purpose:text(b.purpose??previous?.purpose??base.purpose,'适用说明',1000),version:String((previous?.sequence||0)+1)+'.0',sequence:(previous?.sequence||0)+1,enabled:previous?.enabled??true,unitIds:list(b.unitIds??previous?.unitIds??[],'适用单位编号'),required,attachments,bodyBlocks:body};
}
export function updateLetterResources(current,b){
 if(b.expectedRevision!==current.revision)throw new Error('资料版本已变化，请重新打开窗口后重试');
 const next=structuredClone(current),at=new Date().toISOString(),actor=text(b.actor,'维护人员',80);
 if(b.action==='save-template'){
  const previous=b.id?next.templates.find(t=>t.id===b.id):null;if(b.id&&!previous)throw new Error('模板不存在');
  const value=templateValue(b.template,previous&&{...previous,sequence:previous.sequence||1});
  value.updatedAt=at;value.updatedBy=actor;value.history=previous?[...(previous.history||[]),{...previous,history:undefined}]:[];
  if(previous)next.templates[next.templates.indexOf(previous)]=value;else next.templates.push(value);
 }else if(b.action==='set-template-enabled'){
  const t=next.templates.find(t=>t.id===b.id);if(!t||typeof b.enabled!=='boolean')throw new Error('模板或启停状态无效');
  t.history??=[];t.history.push({...t,history:undefined});t.enabled=b.enabled;t.sequence=(t.sequence||1)+1;t.version=t.sequence+'.0';t.updatedAt=at;t.updatedBy=actor;
 }else if(b.action==='import-directory'){
  if(!Array.isArray(b.authorities)||b.authorities.length>1000||!Array.isArray(b.areas)||b.areas.length>2000)throw new Error('目录须包含 authorities 和 areas 数组，且不超过1000个单位/2000个区划');
  const seen=new Set();next.areas=b.areas.map(a=>{const code=text(a.code,'区划代码',100);if(seen.has(code))throw new Error('区划代码重复');seen.add(code);return {code,name:text(a.name,'区划名称',200),source:text(a.source,'区划来源',1000)}});
  const ids=new Set();next.authorities=b.authorities.map(a=>{
   const id=text(a.id,'单位编号',100);if(ids.has(id))throw new Error('单位编号重复');ids.add(id);
   const areaCodes=list(a.areaCodes||[],'单位区划代码'),featureIds=list(a.featureIds||[],'对象编号'),ts=list(a.types,'适用协议类型',5),relationTypes=list(a.relationTypes,'适用空间关系');
   if(!ts.length||ts.some(t=>!types.includes(t))||!relationTypes.length||(!areaCodes.length&&!featureIds.length))throw new Error('单位目录必须指定有效协议类型、空间关系和适用区划或对象');
   if(areaCodes.some(c=>!seen.has(c)))throw new Error('单位引用了未登记的区划代码');
   for(const k of ['validFrom','validTo'])if(a[k]&&(!/^\d{4}-\d{2}-\d{2}$/.test(a[k])||!Number.isFinite(Date.parse(a[k]))||new Date(a[k]).toISOString().slice(0,10)!==a[k]))throw new Error('有效期须为YYYY-MM-DD');
   if(a.validFrom&&a.validTo&&a.validFrom>a.validTo)throw new Error('单位目录有效期倒置');
   return {id,unit:text(a.unit,'收函单位全称',200),areaCodes,featureIds,types:ts,relationTypes,basis:text(a.basis,'管理归属依据',2000),role:text(a.role||'收函单位','单位角色',200),enabled:a.enabled!==false,validFrom:a.validFrom||'',validTo:a.validTo||''};
  });
 }else if(b.action==='import-relations'){
  if(!Array.isArray(b.relations)||b.relations.length>2000)throw new Error('空间关系须为不超过2000条的数组');const ids=new Set();
  next.relations=b.relations.map(r=>{const value={};for(const [k,label] of Object.entries({id:'关系编号',projectId:'工程编号',routeId:'路径编号',routeVersion:'路径版本',segmentId:'区段编号',scope:'区段描述',featureId:'对象编号',featureName:'对象名称',relationType:'空间关系',points:'征询事项',evidence:'数据与触发依据'}))value[k]=text(r[k],label,k==='points'?5000:2000);
   if(ids.has(value.id))throw new Error('空间关系编号重复');ids.add(value.id);if(!types.includes(r.type))throw new Error('关系中的协议类型无效');value.type=r.type;value.areaCodes=list(r.areaCodes||[],'关系区划代码');value.reviewed=r.reviewed===true;return value;});
 }else throw new Error('资料维护操作无效');
 next.revision++;next.updatedAt=at;next.audit.push({at,actor,action:b.action,id:b.id||null,revision:next.revision});return next;
}
export function recommendRecipients(resources,input,{today=new Date().toISOString().slice(0,10)}={}){
 const relevant=resources.relations.filter(r=>r.projectId===input.project.id&&r.routeId===input.route.id),relations=relevant.filter(r=>r.routeVersion===input.project.version);
 return {revision:resources.revision,excludedVersionCount:relevant.length-relations.length,items:relations.map(r=>{
  const candidates=resources.authorities.filter(a=>a.enabled&&(!a.validFrom||a.validFrom<=today)&&(!a.validTo||a.validTo>=today)&&a.types.includes(r.type)&&a.relationTypes.includes(r.relationType)&&(a.featureIds.length?a.featureIds.includes(r.featureId):a.areaCodes.some(c=>r.areaCodes.includes(c)))).map(a=>({authorityId:a.id,unit:a.unit,role:a.role,basis:a.basis,matchBy:a.featureIds.length?'对象编号':'区划代码、类型与关系'}));
  return {relation:r,candidates,status:!r.reviewed?'上游关系待确认':!candidates.length?'缺少单位映射':candidates.length>1?'多个候选待确认':'待人工确认'};
 })};
}
export function validateRecipientReferences(letter,input,agreement,resources){
 const checks=[];
 if(agreement.adminAreaCodes?.length){for(const code of agreement.adminAreaCodes){const area=resources.areas.find(a=>a.code===code);checks.push({field:'区划 '+code,status:area?'passed':'failed',detail:area?.name||'目录中无此区划代码'});if(!area)letter.missingFields.push({field:'adminAreaCodes',label:'区划代码不存在：'+code,blocking:true});}}
 else checks.push({field:'行政区/区段',status:'manual',detail:'未关联区划目录，需人工核对文本区段'});
 if(agreement.authorityId){const a=resources.authorities.find(a=>a.id===agreement.authorityId);let problem='';
  if(!a)problem='目录中无该单位编号';else if(!a.enabled)problem='单位目录记录已停用';else if((a.validFrom&&a.validFrom>new Date().toISOString().slice(0,10))||(a.validTo&&a.validTo<new Date().toISOString().slice(0,10)))problem='单位目录记录不在有效期';else if(a.unit!==agreement.unit)problem='单位名称与目录不一致';else if(!a.types.includes(agreement.type))problem='协议类型不在单位适用范围';else if(a.featureIds.length&&!a.featureIds.includes(agreement.featureId))problem='单位适用对象不匹配';else if(!a.featureIds.length&&a.areaCodes.length&&!(agreement.adminAreaCodes||[]).some(c=>a.areaCodes.includes(c)))problem='单位适用区划不匹配';
  checks.push({field:'收函单位',status:problem?'failed':'passed',detail:problem||a.basis});if(problem)letter.missingFields.push({field:'authorityId',label:problem,blocking:true});
 }else checks.push({field:'收函单位',status:'manual',detail:'未绑定权威单位目录，须按实际资料人工确认'});
 letter.validationChecks=checks;letter.recipientEvidence=agreement.recipientEvidence||null;
}
