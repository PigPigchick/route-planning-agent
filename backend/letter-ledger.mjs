const states=['未发出','已发出待回复','已回复','已闭环'];
function date(v,label){if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString().slice(0,10)!==v)throw new Error(label+'须为有效日期');}
export function recordCorrespondence(task,b){
 if(task.simulation)throw new Error('模拟任务不能记录真实发函和回复');if(task.status==='running')throw new Error('任务运行中不能记录台账');if(b.expectedRevision!==task.revision)throw new Error('任务版本已变化，请刷新后重试');
 const l=task.result.letters.find(l=>l.id===b.letterId);if(!l)throw new Error('函件不存在');const r=b.record;
 if(!r||!states.includes(r.state))throw new Error('业务状态无效');if(typeof b.actor!=='string'||!b.actor.trim()||b.actor.length>80)throw new Error('请填写登记人员');
 for(const k of ['sentAt','replyAt','replySummary','notes','closureNote','referenceNumber','correctionNote'])if(r[k]!==undefined&&(typeof r[k]!=='string'||r[k].length>5000))throw new Error('台账字段格式无效：'+k);
 const previous=l.correspondence||{state:'未发出'},rank=states.indexOf(r.state);
 if(rank>0){if(l.status!=='confirmed'||l.missingFields.length||l.needsRewrite)throw new Error('仅当前版本已人工复核的函件可登记发出/回复状态');date(r.sentAt,'发出日期');}
 if(rank>1){date(r.replyAt,'回复日期');if(r.replyAt<r.sentAt)throw new Error('回复日期不能早于发出日期');if(!r.replySummary?.trim())throw new Error('请填写回复意见摘要');}
 if(rank===3&&!r.closureNote?.trim())throw new Error('闭环需填写处理结果');
 if(rank<states.indexOf(previous.state)&&!r.correctionNote?.trim())throw new Error('状态回退需填写更正原因');
 const at=new Date().toISOString(),record={state:r.state,sentAt:rank?r.sentAt:'',replyAt:rank>1?r.replyAt:'',replySummary:rank>1?r.replySummary.trim():'',notes:r.notes||'',closureNote:rank===3?r.closureNote:'',referenceNumber:r.referenceNumber||'',sentRevision:rank?(previous.sentAt===r.sentAt&&previous.sentRevision||l.revision):null,updatedBy:b.actor.trim(),updatedAt:at};
 l.correspondenceHistory??=[];l.correspondenceHistory.push({at,actor:b.actor.trim(),previous:structuredClone(previous),next:structuredClone(record),correctionNote:r.correctionNote||''});l.correspondence=record;task.revision++;task.updatedAt=at;return task;
}
