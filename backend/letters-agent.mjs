import {planLetters,renderLetterText,refreshSummary,letterReadyStatus,agreementSelectionSignature} from '../dist/letters-core.mjs';
import {validateRecipientReferences} from './letter-resources.mjs';
import {chatJSON,letterMessages,applyModel,previewLetterBody} from './model.mjs';
export function createLettersTask(context,b,assets){
 const input=b.options?.lettersInput;if(!input)throw new Error('协议征询函请从专用页面提交输入资料');
 if(input.project.id!==context.project.id||input.project.version!==context.project.version||!context.routes.some(r=>r.id===input.route.id)||b.routeIds?.[0]!==input.route.id)throw new Error('函件输入与工程、路径快照不一致');
 const mode=b.options.mode||'template';if(!['template','llm'].includes(mode))throw new Error('生成模式无效');
 if(b.options.requireListConfirmation){const c=b.options.listConfirmation,ids=b.options.agreementIds||input.agreements.filter(a=>a.status!=='已完成').map(a=>a.id);if(!c||typeof c.reviewer!=='string'||!c.reviewer.trim()||typeof c.note!=='string'||!c.note.trim()||c.signature!==agreementSelectionSignature(input,ids))throw new Error('当前征询单位与事项清单尚未确认，或确认后资料已变化');}
 const letters=planLetters(input,b.options,assets);for(const l of letters){if(b.options.validationResources&&!b.options.simulation)validateRecipientReferences(l,input,input.agreements.find(a=>l.agreementIds.includes(a.id)),b.options.validationResources);l.status=letterReadyStatus(l);if(mode==='llm'&&l.status!=='blocked'){l.status='pending';l.bodyBlocks=[];l.text='等待大模型生成';l.generation={mode:'llm'}}else l.status=letterReadyStatus(l);}
 return refreshSummary({id:'TASK-'+crypto.randomUUID(),schemaVersion:'letters-v2',agentType:'letters',projectId:input.project.id,projectVersion:input.project.version,routeIds:[input.route.id],contextId:b.contextId,createdAt:new Date().toISOString(),revision:1,status:mode==='llm'?'running':'awaiting_confirmation',mode,input,listConfirmation:b.options.listConfirmation||null,templateCatalog:b.options.templateCatalog,confirmations:[],steps:[{name:'读取协议清单',detail:'按行政区域、部门、完成情况筛选事项'},{name:'匹配模板与缺项检查',detail:'按协议类型匹配；跨越参数和附件逐项检查'},{name:mode==='llm'?'调用大模型组织文字':'按模板形成正文',detail:'数值和附件由程序固定引用'},{name:'人工复核与导出',detail:'资料齐全后逐函确认'}],result:{title:'协议征询函件',letters}});
}
export async function generateLetters(task,config,save,{keepRunning=false}={}){
 task.startedAt??=new Date().toISOString();
 for(const letter of task.result.letters){
  if(letter.status==='blocked')continue;
  task.currentLetterId=letter.id;task.currentUnit=letter.unit;task.progress='正在起草：'+letter.unit;
  letter.status='generating';letter.startedAt=new Date().toISOString();letter.live={phase:'waiting',stream:config.stream===true,updatedAt:letter.startedAt};await save();
  let savedAt=0;
  try{
   let result,bodyBlocks;const attempts=[];
   for(let attempt=1;attempt<=2;attempt++){
   letter.status='generating';letter.live.phase='waiting';letter.live.attempt=attempt;
   task.progress=attempt>1?'正文校验未通过，正在自动修正：'+letter.unit:'正在起草：'+letter.unit;await save();
   result=await chatJSON(config,letterMessages(letter,{repair:attempt>1}),{onProgress:async event=>{
    const phaseChanged=letter.live.phase!==event.phase;
    letter.live={...letter.live,phase:event.phase,updatedAt:new Date().toISOString()};
    if(phaseChanged||Date.now()-savedAt>=200){
     if(event.content!==undefined)letter.previewText=previewLetterBody(letter,event.content);
     savedAt=Date.now();await save();
    }
   }});
   letter.status='checking';letter.live.phase='checking';task.progress='正在检查正文结构与事实引用：'+letter.unit;
   letter.previewText=previewLetterBody(letter,JSON.stringify(result.output));await save();
   try{bodyBlocks=applyModel(letter,result.output);attempts.push({attempt,model:result.model,durationMs:result.durationMs,usage:result.usage,passed:true});break;}
   catch(error){attempts.push({attempt,model:result.model,durationMs:result.durationMs,usage:result.usage,passed:false,error:error.message});letter.generationAttempts=attempts;if(attempt===2)throw error;letter.previewText='';}
   }
   letter.bodyBlocks=bodyBlocks;letter.bodyTemplate=result.output.bodyBlocks;
   letter.status=letterReadyStatus(letter);letter.needsRewrite=false;
   letter.generation={mode:'llm',model:result.model,usage:result.usage,durationMs:attempts.reduce((n,a)=>n+a.durationMs,0),stream:result.stream,thinkingMode:result.thinkingMode,promptVersion:'letters-paragraphs-v2',attempts,at:new Date().toISOString()};delete letter.generationAttempts;letter.text=renderLetterText(letter);
   letter.live.phase='complete';delete letter.previewText;
  }
  catch(e){letter.status='failed';letter.error=e.message;letter.bodyBlocks=[];letter.text='生成或检查失败：'+e.message;letter.live.phase='failed';}
  letter.finishedAt=new Date().toISOString();
  refreshSummary(task);await save();
 }
 task.status=keepRunning?'running':task.result.letters.every(l=>l.status==='failed')?'failed':'awaiting_confirmation';task.progress=task.result.letters.some(l=>l.status==='failed')?'部分函件生成或检查失败，请查看原因':'生成与检查结束，请逐函核对';if(!keepRunning)task.finishedAt=new Date().toISOString();refreshSummary(task);await save();
}
