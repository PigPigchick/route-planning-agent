import {SPECIAL_LETTER_TEMPLATES,CROSSING_FIELDS,crossingRows,validateCrossingRows,crossingTables,normalizeAttachmentName,requestParagraph,buildLetterTitle,assembleTemplateBody} from './letter-rules.mjs';
// 函件结构来自两批用户参考资料的字段归纳；以下为可审阅模板，不复用历史印章、联系人或批复事实。
export const LETTER_TEMPLATES = [
 {id:'general',name:'一般路径征询',version:'1.0',source:'部门发函样例／林业、政府、生态环境',required:[],attachments:['路径图'],purpose:'征询所辖范围内线路路径方案的意见及后续协调要求'},
 {id:'water',name:'河道与航道征询',version:'1.0',source:'肇庆水利局发函／跨河档号与坐标附件',required:[['facilityName','河流或航道名称'],['spanStart','跨越档起点杆塔'],['spanEnd','跨越档终点杆塔'],['coordinateSystem','坐标基准']],attachments:['路径图','坐标表'],purpose:'征询河道或航道跨越路径方案及管理要求'},
 {id:'highway',name:'公路跨越征询',version:'1.0',source:'大埔电厂项目／S12梅龙高速跨越函技术表',required:[['facilityName','公路名称'],['spanStart','跨越档起点杆塔'],['spanEnd','跨越档终点杆塔'],['angleDeg','交叉角 °'],['spanLengthM','档距 m'],['horizontalDistanceM','杆塔至公路最小水平距离 m'],['clearanceM','导线至路面最小距离 m'],['chainage','跨越点里程']],attachments:['航带图','平断面图'],purpose:'征询线路跨越公路路径方案及相关协调意见'},
 {id:'mineral',name:'压覆矿产资源核查',version:'1.0',source:'压矿核查函／中心线范围及转角坐标表',required:[['leftBufferM','中心线左侧核查范围 m'],['rightBufferM','中心线右侧核查范围 m'],['coordinateSystem','坐标基准']],attachments:['路径图','坐标表'],purpose:'申请核查指定线路区段及经确认范围内的矿产资源情况'},
 {id:'aviation',name:'民航协调征询',version:'1.0',source:'民航发函／杆塔经纬度和拟建绝对高程附件',required:[['facilityName','机场名称'],['coordinateSystem','经纬度坐标基准'],['elevationDatum','高程基准']],attachments:['路径图','杆塔坐标高程表'],purpose:'征询相关线路与杆塔布置的航空协调意见'},
 ...SPECIAL_LETTER_TEMPLATES
];
export const TYPE_LABELS=Object.fromEntries(LETTER_TEMPLATES.map(t=>[t.id,t.name]));
export function resolveLetterTemplate(a,catalog=LETTER_TEMPLATES){
 if(a.templateId){const t=catalog.find(t=>t.id===a.templateId&&(t.type||t.id)===a.type);if(!t||t.enabled===false)throw new Error('所选模板不存在或已停用，请选择有效模板：'+a.templateId);if(t.unitIds?.length&&!t.unitIds.includes(a.authorityId))throw new Error('所选模板不适用于当前收函单位');return t;}
 const specific=catalog.filter(t=>(t.type||t.id)===a.type&&t.enabled!==false&&t.unitIds?.includes(a.authorityId));if(specific.length>1)throw new Error('当前单位有多个适用模板，请在协议资料中明确选择');if(specific.length===1)return specific[0];
 const general=catalog.filter(t=>(t.type||t.id)===a.type&&t.enabled!==false&&!t.unitIds?.length),standard=general.find(t=>t.id===a.type);if(standard)return standard;if(general.length===1)return general[0];throw new Error('没有唯一可用的通用模板，请在协议资料中选择有效模板');
}
export function agreementSelectionSignature(input,ids){return JSON.stringify({projectId:input.project.id,version:input.project.version,routeId:input.route.id,routeVersion:input.route.version,agreements:input.agreements.filter(a=>ids.includes(a.id)).map(a=>({id:a.id,unit:a.unit,type:a.type,scope:a.scope,points:a.points,subject:a.subject||'',round:a.round,authorityId:a.authorityId||'',adminAreaCodes:a.adminAreaCodes||[]})).sort((a,b)=>a.id.localeCompare(b.id))});}
const numeric=new Set(['angleDeg','spanLengthM','horizontalDistanceM','clearanceM','leftBufferM','rightBufferM']);
const present=v=>v!==null&&v!==undefined&&String(v).trim()!=='';
const clean=(v,max=12000)=>String(v??'').trim().slice(0,max);
export function inferType(s=''){if(LETTER_TEMPLATES.some(t=>t.id===s))return s;if(/接地极/.test(s))return 'grounding';if(/铁路|铁投|高铁/.test(s))return 'railway';if(/地震|监测台/.test(s))return 'seismic';if(/军区|军事|军队|部队|舰队/.test(s))return 'military';if(/民航|机场/.test(s))return 'aviation';if(/河|水|航道/.test(s))return 'water';if(/高速|道路|交通|公路/.test(s))return 'highway';if(/矿/.test(s))return 'mineral';return 'general';}
export function createLettersInput(c,r){return {schemaVersion:'letters-v2',project:{id:c.project.id,name:c.project.name,version:c.project.version,voltage:c.project.voltage,stage:c.project.stage,isDemo:!!c.project.isDemo,overview:c.project.overview||`${c.project.name}，电压等级${c.project.voltage}，目前处于${c.project.stage}阶段。`,issuer:'',issueDate:'',documentNumber:'',contactName:'',contactPhone:'',replyAddress:''},route:{id:r.id,version:c.project.version,summary:r.summary||`${r.name}起于${c.project.start||'待补充'}，止于${c.project.end||'待补充'}，途经${(r.via||[]).join('、')}，路径长度约${r.length} km。`},agreements:c.agreements.map(a=>({id:a.id,unit:a.unit,type:inferType(a.type),scope:a.scope||a.segment||[a.city,a.county,a.administrativeRegion].filter(Boolean).join(' / '),points:a.points,subject:a.subject||'',status:a.status||a.completionStatus||'未发函',round:a.round||'first',replySummary:a.replySummary||'',previousLetter:a.previousLetter||'',changeSummary:a.changeSummary||'',facts:structuredClone(a.facts||{}),...(a.crossings!==undefined?{crossings:structuredClone(a.crossings)}:{}),attachments:(a.attachments||[]).map(name=>({name,kind:/坐标/.test(name)?'坐标表':/断面/.test(name)?'平断面图':/航带/.test(name)?'航带图':/路径|示意/.test(name)?'路径图':'其他',assetId:'',routeVersion:c.project.version}))})),templateConfirmed:false};}
export function validateLettersInput(input,{allowEmpty=false}={}){
 if(!input||typeof input.project!=='object'||typeof input.route!=='object'||input.schemaVersion!=='letters-v2'||!input.project?.id||!input.project?.name||!input.project?.version||!input.route?.id)throw new Error('函件输入缺少工程编号、名称、版本或路径编号');
 if(!Array.isArray(input.agreements)||(!allowEmpty&&!input.agreements.length)||input.agreements.length>500)throw new Error('协议清单需包含 '+(allowEmpty?'0':'1')+'–500 条事项');
 if(input.project.issueDate&&(!/^\d{4}-\d{2}-\d{2}$/.test(input.project.issueDate)||!Number.isFinite(Date.parse(input.project.issueDate))||new Date(input.project.issueDate).toISOString().slice(0,10)!==input.project.issueDate))throw new Error('发函日期无效');
 for(const [k,v] of Object.entries(input.project)){if(k!=='isDemo'&&typeof v!=='string')throw new Error('工程字段 '+k+' 须为文字');if(typeof v==='string'&&v.length>12000)throw new Error('工程字段过长：'+k)}
 const ids=new Set();for(const a of input.agreements){if(!a||!a.id||ids.has(a.id))throw new Error('协议事项编号缺失或重复');ids.add(a.id);if(a.templateId!==undefined&&(typeof a.templateId!=='string'||a.templateId.length>100))throw new Error('模板编号无效');if(a.adminAreaCodes!==undefined&&(!Array.isArray(a.adminAreaCodes)||a.adminAreaCodes.length>50||a.adminAreaCodes.some(x=>typeof x!=='string'||x.length>100)))throw new Error('区划代码须为文字数组');if(a.subject!==undefined&&(typeof a.subject!=='string'||a.subject.length>180||/[\r\n<>]/.test(a.subject)))throw new Error('征询主题须为不超过180字的单行文字');if(a.facts!==undefined&&(!a.facts||typeof a.facts!=='object'||Array.isArray(a.facts)))throw new Error('专项资料须为字段对象');validateCrossingRows(a);for(const k of ['id','unit','scope','points','previousLetter','changeSummary'])if(a[k]!==undefined&&(typeof a[k]!=='string'||a[k].length>12000))throw new Error('协议字段格式无效：'+k);if(!LETTER_TEMPLATES.some(t=>t.id===a.type))throw new Error(`事项 ${a.id} 的征询类型无对应模板`);if(!['first','repeat','revised'].includes(a.round))throw new Error('征询轮次无效');for(const [key,v] of Object.entries(a.facts||{})){if(numeric.has(key)&&present(v)&&(typeof v!=='number'||!Number.isFinite(v)||v<0))throw new Error(`${a.id} 的 ${key} 须为非负数`)}if(present(a.facts?.angleDeg)&&a.facts.angleDeg>180)throw new Error('交叉角须位于 0–180°');if(!Array.isArray(a.attachments)||a.attachments.length>20||a.attachments.some(x=>!x||typeof x.name!=='string'||!x.name.trim()||typeof x.kind!=='string'||x.assetId!==undefined&&typeof x.assetId!=='string'))throw new Error('附件列表无效或超过 20 项');}
 if(JSON.stringify(input).length>2000000)throw new Error('函件输入过大，请按区段拆分');return input;
}
export function planLetters(input,options={},assets={}){
 validateLettersInput(input);const ids=options.agreementIds||input.agreements.filter(a=>a.status!=='已完成').map(a=>a.id);
 if(!ids.length||ids.some(id=>!input.agreements.some(a=>a.id===id)))throw new Error('请至少选择一条有效协议事项');
 if(ids.length>30)throw new Error('每次最多起草30份函件，请在清单中分批勾选');
 return [...new Set(ids)].map((id,index)=>{
 const a=input.agreements.find(x=>x.id===id),t=resolveLetterTemplate(a,options.templateCatalog),missing=[],warnings=[];const add=(field,label,blocking=false)=>missing.push({field,label,blocking});
 if(!clean(a.unit))add('unit','收函单位正式全称',true);if(!clean(a.scope))add('scope','征询行政区或区段');if(!clean(a.points))add('points','征询事项',true);if(!clean(input.project.overview))add('project.overview','工程概况',true);if(!clean(input.route.summary))add('route.summary','路径描述',true);
 const rowFields=CROSSING_FIELDS[a.type]||[];
 for(const [k,label] of t.required)if(!(a.crossings!==undefined&&rowFields.some(([field])=>field===k))&&!present(a.facts?.[k]))add('facts.'+k,label);
 if(a.crossings!==undefined)for(const [i,row] of crossingRows(a).entries())for(const [k,label] of rowFields)if(!present(row[k]))add('crossings.'+i+'.'+k,'第'+(i+1)+'处跨越 · '+label);
 for(const [k,label] of [['issuer','发函单位'],['issueDate','发函日期'],['contactName','联系人'],['contactPhone','联系电话'],['replyAddress','复函地址']])if(!clean(input.project[k]))add('project.'+k,label);
 if(input.route.version!==input.project.version)add('route.version','工程和路径版本不一致',true);
 if(a.round!=='first'&&!clean(a.previousLetter))add('previousLetter','前次函件与意见');if(a.round==='revised'&&!clean(a.changeSummary))add('changeSummary','本次路径调整原因');
 if(!input.templateConfirmed)add('templateConfirmed','模板已经业务人工核对');
 const attachments=a.attachments.map((v,i)=>({...v,name:normalizeAttachmentName(v.name),number:i+1,available:!!(v.assetId&&assets[v.assetId]),fileName:assets[v.assetId]?.name||v.name}));
 for(const kind of t.attachments)if(!attachments.some(v=>v.kind===kind&&v.available))add('attachments.'+kind,kind+'实际文件');
 for(const x of attachments){if(!x.available&&!t.attachments.includes(x.kind))add('attachments.'+x.number,x.name+'实际文件');if(x.routeVersion&&x.routeVersion!==input.project.version)add('attachments.'+x.number+'.version',x.name+'路径版本冲突',true)}
 if(a.status==='已完成')warnings.push('该事项在输入清单中已完成，本次为用户主动选择重新起草。');
 if(input.project.isDemo)warnings.push('当前工程为演示数据，正文及参数仅供演示。');
 const title=buildLetterTitle(a,input.project.name);
 const tables=crossingTables(a);
 const fields=t.required.filter(([k])=>!(a.crossings!==undefined&&rowFields.some(([field])=>field===k))&&present(a.facts?.[k])).map(([k,label])=>label+'：'+a.facts[k]);
 if(a.crossings!==undefined)fields.push('本次涉及'+a.crossings.length+'处跨越，逐项参数见'+tables[0].title);
 const special=fields.length?'本次相关技术资料如下：'+fields.join('；')+'。':'';
 const tokens={projectName:clean(input.project.name),projectOverview:clean(input.project.overview),routeSummary:clean(input.route.summary),requestItems:requestParagraph(clean(a.points)),specialFacts:special,historySummary:[a.previousLetter?'前次函件与意见：'+clean(a.previousLetter):'',a.changeSummary?'本次路径调整说明：'+clean(a.changeSummary):''].filter(Boolean).join('\n')};
 const letter={id:`LETTER-${index+1}`,agreementIds:[a.id],routeId:input.route.id,unit:clean(a.unit)||'收函单位待补充',type:a.type,typeLabel:t.name,scope:clean(a.scope),sourceStatus:a.status,replySummary:a.replySummary||'',round:a.round,title,template:t.name+' v'+t.version,templateRef:{id:t.id,version:t.version,source:t.source,bodyBlocks:t.bodyBlocks||null,required:t.required,attachments:t.attachments},status:missing.some(m=>m.blocking)?'blocked':'draft',revision:1,missingFields:missing,warnings,attachments,tables,tokens,issuer:JSON.parse(JSON.stringify(input.project)),confirmations:[],edits:[],generation:{mode:'template'},bodyBlocks:[]};
 letter.bodyBlocks=assembleTemplateBody(t.bodyBlocks||['{{projectOverview}}','{{routeSummary}}','{{specialFacts}}',...(a.round!=='first'?['{{historySummary}}']:[]),'{{requestItems}}','专此函达，请予支持。'],tokens);
 letter.text=renderLetterText(letter);return letter;
 });
}
export function renderLetterText(l){return `${l.simulation?'【模拟测试 · 非真实工程资料 · 未经人工复核】\n\n':''}${l.title}\n\n${l.unit}：\n\n${l.bodyBlocks.join('\n\n')}\n\n${l.tables.map(t=>t.title+'\n'+t.headers.join(' | ')+'\n'+t.rows.map(r=>r.join(' | ')).join('\n')).join('\n')}\n\n附件：\n${l.attachments.map(a=>`${a.number}. ${a.name}${a.available?'':'（文件待关联/核对）'}`).join('\n')||'无已关联附件'}\n\n${l.issuer.issuer||'发函单位待填写'}\n${l.issuer.issueDate||'日期待填写'}\n联系人：${l.issuer.contactName||'待填写'}　联系电话：${l.issuer.contactPhone||'待填写'}\n复函地址：${l.issuer.replyAddress||'待填写'}`;}
export function letterReadyStatus(letter){return letter.missingFields.some(x=>x.blocking)?'blocked':letter.missingFields.length?'incomplete':'draft';}
export function refreshSummary(task){const ls=task.result.letters;task.result.summary={planned:ls.length,pending:ls.filter(l=>['pending','generating','checking'].includes(l.status)).length,draft:ls.filter(l=>l.status==='draft').length,incomplete:ls.filter(l=>l.status==='incomplete').length,needsRewrite:ls.filter(l=>l.status==='needs_rewrite').length,blocked:ls.filter(l=>l.status==='blocked').length,failed:ls.filter(l=>l.status==='failed').length,confirmed:ls.filter(l=>l.status==='confirmed').length,simulated:ls.filter(l=>l.status==='simulated').length};if(ls.length&&ls.every(l=>l.status==='confirmed'))task.status='confirmed';return task;}
// These fields affect the body, rather than its heading, footer, or attached files.
function draftingFacts(input,id){const a=input.agreements.find(x=>x.id===id);return {projectName:input.project.name,overview:input.project.overview,route:input.route,scope:a.scope,type:a.type,points:a.points,subject:a.subject||'',crossings:a.crossings,round:a.round,templateId:a.templateId||a.type,facts:a.facts||{},previousLetter:a.previousLetter||'',changeSummary:a.changeSummary||''};}
export function updateLettersInput(task,b,assets={}){
 if(task.simulation)throw new Error('模拟记录不能覆盖真实资料，请重新运行模拟流程');
 if(task.status==='running')throw new Error('任务仍在生成，请稍后更新资料');
 if(b.expectedRevision!==task.revision)throw new Error('任务版本已变化，请刷新任务状态后重试');
 const input=validateLettersInput(b.lettersInput,{allowEmpty:true});
 if(input.project.id!==task.projectId||input.project.version!==task.projectVersion||input.route.id!==task.routeIds[0])throw new Error('更新资料须保持工程、版本和路径一致');
 const inputIds=new Set(input.agreements.map(a=>a.id));
 const remaining=task.result.letters.filter(l=>l.agreementIds.every(id=>inputIds.has(id)));
 const removed=task.result.letters.filter(l=>!remaining.includes(l));
 const ids=remaining.flatMap(l=>l.agreementIds);
 const planned=ids.length?planLetters(input,{agreementIds:ids,templateCatalog:task.templateCatalog},assets):[];
 const at=new Date().toISOString();let changed=JSON.stringify(task.input)!==JSON.stringify(input);
 const letters=remaining.map((old,index)=>{
  const fresh=planned[index];
  const contentChanged=JSON.stringify(draftingFacts(task.input,old.agreementIds[0]))!==JSON.stringify(draftingFacts(input,old.agreementIds[0]));
  const needsRewrite=old.needsRewrite===true||contentChanged;
  let next={...old,...fresh,id:old.id,revision:old.revision,confirmations:old.confirmations,correspondence:old.correspondence,correspondenceHistory:old.correspondenceHistory,edits:old.edits,generation:old.generation,bodyBlocks:old.bodyBlocks,bodyTemplate:old.bodyTemplate,needsRewrite};
  next.status=letterReadyStatus(fresh);
  if(next.status!=='blocked'){
   if(task.mode==='llm'&&(old.status==='failed'||!old.bodyBlocks?.length))next.status=old.status==='failed'?'failed':'needs_rewrite';
   else if(needsRewrite)next.status='needs_rewrite';
  }
  if(next.status!=='failed')delete next.error;
  next.text=renderLetterText(next);
  const affected=JSON.stringify({...next,status:undefined,revision:undefined})!==JSON.stringify({...old,status:undefined,revision:undefined});
  if(!affected&&old.status==='confirmed'&&next.status==='draft')next.status='confirmed';
  if(affected||next.status!==old.status){next.revision++;changed=true;next.updatedAt=at;}
  return next;
 });
 if(changed){task.inputUpdates??=[];task.inputUpdates.push({at,revision:task.revision,input:task.input});if(removed.length){task.removedLetters??=[];task.removedLetters.push(...removed.map(letter=>({at,taskRevision:task.revision,letter:structuredClone(letter)})));}task.input=structuredClone(input);task.result.letters=letters;task.revision++;task.updatedAt=at;task.status='awaiting_confirmation';}
 return refreshSummary(task);
}
export function reviewLetter(task,b){
 if(task.simulation)throw new Error('模拟确认不属于人工复核');
 const l=task.result.letters.find(l=>l.id===b.letterId);if(!l)throw new Error('函件不存在');if(b.expectedRevision!==l.revision)throw new Error('函件版本已变化，请刷新后重试');
 if(b.action==='edit'){
 if(!['draft','confirmed','incomplete','needs_rewrite'].includes(l.status))throw new Error('请先补齐阻断资料或重新起草正文');if(!Array.isArray(b.bodyBlocks)||b.bodyBlocks.length<1||b.bodyBlocks.length>20||b.bodyBlocks.some(x=>typeof x!=='string'||!x.trim()||x.length>6000))throw new Error('正文段落无效');
 l.edits.push({revision:l.revision,bodyBlocks:l.bodyBlocks,at:new Date().toISOString()});l.bodyBlocks=b.bodyBlocks.map(v=>clean(v,6000));l.needsRewrite=false;l.status=letterReadyStatus(l);l.revision++;l.text=renderLetterText(l);task.status='awaiting_confirmation';
 }else{
 if(l.missingFields.length)throw new Error('资料未齐：'+l.missingFields.map(x=>x.label).join('、'));if(l.status!=='draft'||l.needsRewrite)throw new Error('仅待复核草稿可以确认，请先完成正文起草和检查');if(!clean(b.reviewer)||!clean(b.note))throw new Error('请填写复核人员和意见');
 l.confirmations.push({reviewer:clean(b.reviewer,80),note:clean(b.note,3000),revision:l.revision,at:new Date().toISOString()});l.status='confirmed';l.revision++;
 }
 task.revision++;return refreshSummary(task);
}
