// Missing input is not evidence that the supplier omitted the source material.
export function materialCheckItems(letter){
 return (letter.missingFields||[]).map(m=>{
  const base={field:m.field,item:m.label,blocking:!!m.blocking};
  if(m.field.startsWith('attachments.')){
   if(m.field.endsWith('.version'))return {...base,category:'待核对',state:'附件版本冲突',action:'核对所选路径版本与附件版本，关联一致版本的文件；无需直接要求重交全部附件。'};
   return {...base,category:'附件待关联',state:'未关联可用文件，尚不能判定资料未提供',action:'先核对已交付ZIP或工程文件库，关联对应文件；找不到时请业务方确认文件名、位置及适用区段，确未提供再补交。'};
  }
  if(m.field==='templateConfirmed')return {...base,category:'待核对',state:'模板适用性尚未确认',action:'由设计人员核对本次采用的模板；这不是需要另行提供的资料。'};
  if(m.field==='route.version'||m.field==='authorityId'||m.field==='adminAreaCodes')return {...base,category:'待核对',state:'版本或目录信息需要核对',action:'核对平台路径、单位及区划目录，修正冲突后保存。'};
  const action=m.field==='unit'?'先从平台已有协议清单读取收函单位正式全称；仍无对应记录时，请业务人员确认单位与区段的对应关系。':m.field.startsWith('project.')?'先从工程资料或发函人员处补录；原资料未给出的内容再请业务方提供。':m.field.startsWith('route.')?'先从平台已有路径资料补录；未获取到资料时再联系平台或业务负责人。':'先核对已有正文、参数表和平台资料并补录；确认原资料没有该项时，再请业务方补充。';
  return {...base,category:'信息未录入',state:'当前输入未填写，原资料是否已有需核对',action};
 });
}
const md=s=>String(s??'').replace(/\|/g,'\\|').replace(/[\r\n]+/g,' ');
export function materialsChecklistMarkdown(letters,{projectName='',routeId='',version='',stale=false}={}){
 const lines=['# 协议征询函资料核对与补充清单','',`工程：${md(projectName)}　路径：${md(routeId)}　版本：${md(version)}`,'',...(stale?['注意：当前输入有资料待同步，本清单依据上一次已同步的任务生成。','']:[]),'本清单区分“信息未录入”“附件待关联”和“待核对”。未填写或未关联不等于甲方未提供；先核对现有资料，确实没有时再补充。','', '| 协议编号 | 收函单位 | 类别 | 具体项目 | 当前情况 | 处理方式 |','|---|---|---|---|---|---|'];
 let count=0;
 for(const letter of letters)for(const item of materialCheckItems(letter)){count++;lines.push('|'+[letter.agreementIds.join('、'),letter.unit,item.category,item.item,item.state+(item.blocking?'；当前阻断生成':''),item.action].map(md).join('|')+'|');}
 if(!count)lines.push('|—|—|检查通过|当前资料检查无待处理项|仍须按流程核对正文|不代表已发函或取得业务审批|');
 lines.push('','核对反馈可注明：已提供的文件名/位置、适用路径版本、未提供时的补交内容和联系人。');return lines.join('\n')+'\n';
}
