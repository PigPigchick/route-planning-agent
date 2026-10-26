import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput,updateLettersInput,reviewLetter} from './dist/letters-core.mjs';
import {createLettersTask,generateLetters} from './backend/letters-agent.mjs';
import {previewLetterBody,readChatStream} from './backend/model.mjs';

function fixture(mode='llm'){
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);
 input.agreements=input.agreements.slice(0,1);input.templateConfirmed=true;
 Object.assign(input.project,{issuer:'测试发函单位',issueDate:'2026-10-22',contactName:'测试联系人',contactPhone:'测试电话',replyAddress:'测试地址'});
 input.agreements[0].attachments=[{name:'测试路径图.png',kind:'路径图',assetId:'asset-a',routeVersion:input.project.version}];
 const assets={'asset-a':{name:'测试路径图.png'},'asset-b':{name:'替换路径图.pdf'}};
 const t=createLettersTask(SAMPLE,{contextId:'test',routeIds:['A'],options:{mode,lettersInput:input}},assets);
 const l=t.result.letters[0];
 if(mode==='llm'){t.status='awaiting_confirmation';l.status='draft';l.needsRewrite=false;l.bodyBlocks=['已人工调整的工程概况。','已人工调整的路径说明。','请函复本次征询事项。'];l.generation={mode:'llm',model:'test-model'};}
 return {t,input,assets,l};
}
const update=(t,input,assets)=>updateLettersInput(t,{expectedRevision:t.revision,lettersInput:input},assets);

test('普通资料和附件更新保留模型正文及人工编辑，撤销旧版确认且无需调用模型',()=>{
 const {t,input,assets,l}=fixture();
 reviewLetter(t,{action:'confirm',letterId:l.id,expectedRevision:l.revision,reviewer:'QA',note:'已核对'});
 const body=structuredClone(l.bodyBlocks),generation=structuredClone(l.generation),oldRevision=l.revision;
 const edited=structuredClone(input);edited.project.issueDate='2026-10-23';edited.project.contactName='更新联系人';edited.agreements[0].attachments[0]={name:'替换路径图.pdf',kind:'路径图',assetId:'asset-b',routeVersion:input.project.version};
 update(t,edited,assets);const next=t.result.letters[0];
 assert.equal(next.status,'draft');assert.equal(next.needsRewrite,false);assert.equal(next.revision,oldRevision+1);
 assert.deepEqual(next.bodyBlocks,body);assert.deepEqual(next.generation,generation);assert.equal(next.confirmations.length,1);
 assert.match(next.text,/2026-10-23/);assert.match(next.text,/替换路径图.pdf/);assert.deepEqual(next.missingFields,[]);
 assert.throws(()=>reviewLetter(t,{action:'confirm',letterId:l.id,expectedRevision:oldRevision,reviewer:'QA',note:'旧版'}),/版本/);
 const rev=t.revision;update(t,edited,assets);assert.equal(t.revision,rev);
 reviewLetter(t,{action:'confirm',letterId:l.id,expectedRevision:next.revision,reviewer:'QA',note:'新版核对'});
 const confirmedRevision=t.revision;update(t,edited,assets);assert.equal(t.status,'confirmed');assert.equal(t.revision,confirmedRevision);
});

test('移除实际附件立即显示缺项，重新关联后恢复待复核，模板正文人工修改也保留',()=>{
 const {t,input,assets,l}=fixture('template');
 reviewLetter(t,{action:'edit',letterId:l.id,expectedRevision:1,bodyBlocks:['人工修订的正文']});
 const edited=structuredClone(input);edited.agreements[0].attachments=[];
 update(t,edited,assets);assert.equal(t.result.letters[0].status,'incomplete');assert.match(t.result.letters[0].missingFields[0].label,/路径图/);
 assert.throws(()=>reviewLetter(t,{action:'confirm',letterId:l.id,expectedRevision:t.result.letters[0].revision,reviewer:'QA',note:'缺附件'}),/资料未齐/);
 update(t,input,assets);assert.equal(t.result.letters[0].status,'draft');assert.deepEqual(t.result.letters[0].bodyBlocks,['人工修订的正文']);
});

test('正文事实变化只标记待重写，不自动覆盖正文；人工修订后可以复核',()=>{
 const {t,input,assets,l}=fixture();const body=structuredClone(l.bodyBlocks),edited=structuredClone(input);edited.agreements[0].points='更新后的征询事项';
 update(t,edited,assets);const next=t.result.letters[0];assert.equal(next.status,'needs_rewrite');assert.deepEqual(next.bodyBlocks,body);
 assert.throws(()=>reviewLetter(t,{action:'confirm',letterId:l.id,expectedRevision:next.revision,reviewer:'QA',note:'旧正文'}),/正文/);
 reviewLetter(t,{action:'edit',letterId:l.id,expectedRevision:next.revision,bodyBlocks:['人工根据更新后的征询事项修改了正文。']});
 assert.equal(next.status,'draft');assert.equal(next.needsRewrite,false);
 update(t,edited,assets);assert.equal(t.result.letters[0].status,'draft');
});

test('资料更新拒绝旧版本、跨工程、无效类型及运行中修改，失败不污染任务',()=>{
 const {t,input,assets}=fixture(),before=JSON.stringify(t);
 for(const request of [{expectedRevision:0,lettersInput:input},{expectedRevision:t.revision,lettersInput:{...input,project:{...input.project,id:'other'}}},{expectedRevision:t.revision,lettersInput:{...input,agreements:[{...input.agreements[0],type:'invalid'}]}}]){
  assert.throws(()=>updateLettersInput(t,request,assets));assert.equal(JSON.stringify(t),before);
 }
 t.status='running';assert.throws(()=>update(t,input,assets),/仍在生成/);
});

test('删除已复核函件归档完整记录，可清空并重新新增，生成仍需至少一项',()=>{
 const {t,input,assets,l}=fixture('template');
 reviewLetter(t,{action:'confirm',letterId:l.id,expectedRevision:l.revision,reviewer:'QA',note:'已核对'});
 l.correspondence={state:'已回复',replySummary:'历史回复'};
 const before=structuredClone(l),empty={...structuredClone(input),agreements:[]};
 update(t,empty,assets);
 assert.deepEqual(t.result.letters,[]);assert.equal(t.result.summary.planned,0);assert.equal(t.status,'awaiting_confirmation');
 assert.deepEqual(t.removedLetters[0].letter,before);assert.equal(t.inputUpdates.at(-1).input.agreements.length,1);
 assert.throws(()=>createLettersTask(SAMPLE,{contextId:'test',routeIds:['A'],options:{mode:'template',lettersInput:empty}},assets),/协议清单需包含/);
 const revision=t.revision;update(t,empty,assets);assert.equal(t.revision,revision);assert.equal(t.removedLetters.length,1);
 const restored=structuredClone(input);restored.agreements[0].id='NEW-ITEM';update(t,restored,assets);
 assert.equal(t.input.agreements.length,1);assert.equal(t.result.letters.length,0);assert.equal(t.removedLetters.length,1);
 const generated=createLettersTask(SAMPLE,{contextId:'test',routeIds:['A'],options:{mode:'template',lettersInput:restored}},assets);
 assert.deepEqual(generated.result.letters[0].agreementIds,['NEW-ITEM']);
});

test('流式正文预览解析不完整 JSON、跨包转义和占位符，不暴露原始 JSON 字段',()=>{
 const {l}=fixture();
 assert.equal(previewLetterBody(l,'{"bodyBlocks":["工程 \\u4e2d'), '工程 中');
 assert.equal(previewLetterBody(l,'{"bodyBlocks":["工程 \\u4e'), '工程 ');
 assert.equal(previewLetterBody(l,'{"bodyBlocks":["引号\\"与换行\\n","{{routeSummary}}"'), '引号"与换行\n\n\n'+l.tokens.routeSummary);
 assert.equal(previewLetterBody(l,'{"factsUsed":["secret"]}'),'');
});

test('流式接收期间提供逐步正文，推理内容只产生状态，不传给正文回调',async()=>{
 const seen=[],encoder=new TextEncoder();
 const chunks=[{choices:[{delta:{reasoning_content:'PRIVATE_REASONING'}}]},{choices:[{delta:{content:'{"bodyBlocks":["起'}}]},{choices:[{delta:{content:'草中"]}'},finish_reason:'stop'}]}];
 const response=new Response(new ReadableStream({start(c){for(const p of chunks)c.enqueue(encoder.encode('data: '+JSON.stringify(p)+'\n\n'));c.enqueue(encoder.encode('data: [DONE]\n\n'));c.close()}}));
 const result=await readChatStream(response,e=>seen.push(e));
 assert.deepEqual(seen.map(x=>x.phase),['thinking','writing','writing']);
 assert.ok(!JSON.stringify(seen).includes('PRIVATE_REASONING'));assert.equal(JSON.parse(result.choices[0].message.content).bodyBlocks[0],'起草中');
});

test('完整模型输出检查成功后才进入待复核；失败保留具体原因且不接受正文',async()=>{
 const original=globalThis.fetch;
 try{
  for(const invalid of [false,true]){
   const {input,assets}=fixture();const t=createLettersTask(SAMPLE,{contextId:'test',routeIds:['A'],options:{mode:'llm',lettersInput:input}},assets);
   const bodyBlocks=['{{projectOverview}}','{{routeSummary}}','请就{{requestItems}}函复。',...(invalid?['净空99米。']:[])];
   globalThis.fetch=async()=>new Response(JSON.stringify({choices:[{finish_reason:'stop',message:{content:JSON.stringify({bodyBlocks})}}]}));
   const stages=[];await generateLetters(t,{model:'test',apiKey:'synthetic',baseUrl:'http://mock'},async()=>{stages.push(t.result.letters[0].status)});
   assert.ok(stages.includes('generating'));assert.ok(stages.includes('checking'));
   assert.equal(t.result.letters[0].status,invalid?'failed':'draft');
   if(invalid){assert.match(t.result.letters[0].error,/新增数值/);assert.deepEqual(t.result.letters[0].bodyBlocks,[]);assert.ok(t.result.letters[0].previewText);}
   else assert.equal(t.result.letters[0].live.phase,'complete');
  }
 }finally{globalThis.fetch=original;}
});
