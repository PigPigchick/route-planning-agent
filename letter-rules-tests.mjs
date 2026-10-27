import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput,planLetters,validateLettersInput,updateLettersInput} from './dist/letters-core.mjs';
import {buildLetterTitle,normalizeAttachmentName,crossingRows} from './dist/letter-rules.mjs';
import {createLetterResources,upgradeLetterResources,updateLetterResources,DEFAULT_BODY} from './backend/letter-resources.mjs';
import {applyModel,letterMessages} from './backend/model.mjs';
import {createLettersTask,generateLetters} from './backend/letters-agent.mjs';
import {simulationFields,applySimulationValues} from './backend/letters-simulation.mjs';
const row={facilityName:'测试高速',spanStart:'NA1',spanEnd:'NA2',angleDeg:78,spanLengthM:168,horizontalDistanceM:47.34,clearanceM:29,chainage:'跨越高速匝道'};
function input(){const i=createLettersInput(SAMPLE,SAMPLE.routes[0]);i.agreements=i.agreements.slice(0,1);return i;}
function highway(){const i=input();Object.assign(i.agreements[0],{type:'highway',facts:{},crossings:[{...row},{...row,spanStart:'NA2',spanEnd:'NA3',angleDeg:80,spanLengthM:688,horizontalDistanceM:78.05,clearanceM:27.5,chainage:'K24+750m'}]});return i;}
function task(i=input()){return createLettersTask(SAMPLE,{routeIds:['A'],options:{mode:'llm',lettersInput:i}},{});}
const response=bodyBlocks=>new Response(JSON.stringify({model:'regression-mock',choices:[{finish_reason:'stop',message:{content:JSON.stringify({bodyBlocks})}}]}));

test('多档公路跨越保留每行全部数值和零值，正文引用表格且不截取第一行',()=>{
 const i=highway(),l=planLetters(i)[0];assert.deepEqual(l.tables[0].rows.map(r=>r.slice(2)),[['NA1～NA2','78°','168','47.34','29','跨越高速匝道'],['NA2～NA3','80°','688','78.05','27.5','K24+750m']]);assert.match(l.tokens.specialFacts,/2处跨越/);
 i.agreements[0].crossings[1].angleDeg=0;assert.ok(!planLetters(i)[0].missingFields.some(m=>m.field==='crossings.1.angleDeg'));
 delete i.agreements[0].crossings[1].spanEnd;assert.ok(planLetters(i)[0].missingFields.some(m=>m.field==='crossings.1.spanEnd'&&m.label.includes('第2处')));
 i.agreements[0].crossings[0].angleDeg=181;assert.throws(()=>validateLettersInput(i),/数值无效/);
 i.agreements[0].crossings=[];assert.throws(()=>validateLettersInput(i),/1至50行/);
});
test('河道多行仅继承设施和坐标基准，不将第一行杆塔误作其他行',()=>{
 const i=input(),a=i.agreements[0];Object.assign(a,{type:'water',facts:{facilityName:'测试河',coordinateSystem:'CGCS2000',spanStart:'OLD1',spanEnd:'OLD2'},crossings:[{spanStart:'N1',spanEnd:'N2'},{facilityName:'第二条测试河',spanStart:'N5'}]});
 const l=planLetters(i)[0];assert.equal(l.tables[0].rows.length,2);assert.equal(l.tables[0].rows[1][1],'第二条测试河');assert.equal(l.tables[0].rows[1][3],'待补');assert.match(l.title,/测试河、第二条测试河/);assert.ok(l.missingFields.some(m=>m.field==='crossings.1.spanEnd'));
});
test('旧版单档输入仍可生成，编辑迁移不会带入其他专项字段',()=>{
 const i=highway(),a=i.agreements[0];delete a.crossings;a.facts={...row,unrelated:'自定义资料'};assert.equal(planLetters(i)[0].tables[0].rows.length,1);a.crossings=crossingRows(a);assert.equal(a.crossings[0].unrelated,undefined);assert.doesNotThrow(()=>validateLettersInput(i));
});
test('新增专项模板和征询主题形成对应标题，压矿不套一般路径标题',()=>{
 const i=input();for(const [type,word] of [['grounding','接地极址'],['railway','铁路'],['seismic','地震监测'],['military','军事设施'],['mineral','申请核查']]){const a={...i.agreements[0],type,facts:{}};assert.match(buildLetterTitle(a,'测试工程'),new RegExp(word));assert.ok(createLetterResources().templates.some(t=>t.id===type));}
 const a={...i.agreements[0],subject:'紫金段优化调整路径方案',round:'revised'};assert.equal(buildLetterTitle(a,'测试工程'),'关于重新征询测试工程紫金段优化调整路径方案意见的函');
});
test('完整征询事项不重复包裹，短事项由程序组成完整请求；附件编号只输出一次',()=>{
 const i=input(),a=i.agreements[0];a.points='现就上述路径征询贵单位意见，请研究后函复。';a.attachments=[{name:'附件1：1. 路径图.pdf',kind:'路径图'}];const l=planLetters(i,{templateCatalog:createLetterResources().templates})[0];assert.equal(l.tokens.requestItems,a.points);assert.ok(l.bodyBlocks.includes(a.points));assert.ok(!l.text.includes('现就现就'));assert.match(l.text,/1\. 路径图.pdf/);assert.ok(!l.text.includes('1. 1.'));
 a.points='林地管理要求';assert.match(planLetters(i)[0].tokens.requestItems,/现就以下事项/);assert.equal(normalizeAttachmentName('2022.4.28路径图.pdf'),'2022.4.28路径图.pdf');
});
test('内置模板自动升级可追溯且幂等，保留停用、目录、自定义内容和历史任务',()=>{
 const r=createLetterResources();r.templates=r.templates.slice(0,5);const old=[...DEFAULT_BODY];old[4]='现就{{requestItems}}征询贵单位意见，请予指导并函复。';r.templates[0].bodyBlocks=old;r.templates[0].enabled=false;r.templates[1].bodyBlocks=[...DEFAULT_BODY,'自定义结束语'];r.authorities=[{id:'unchanged'}];const before=structuredClone(r),u=upgradeLetterResources(r);
 assert.deepEqual(r,before);assert.equal(u.templates.length,9);assert.equal(u.templates[0].version,'2.0');assert.equal(u.templates[0].enabled,false);assert.deepEqual(u.templates[0].history[0].bodyBlocks,old);assert.deepEqual(u.templates[1].bodyBlocks,r.templates[1].bodyBlocks);assert.deepEqual(u.authorities,r.authorities);assert.equal(upgradeLetterResources(u),u);
});
test('模板维护拒绝在保护段落两侧套话',()=>{
 const r=createLetterResources();assert.throws(()=>updateLetterResources(r,{expectedRevision:r.revision,actor:'维护人',action:'save-template',template:{...r.templates[0],bodyBlocks:['{{projectOverview}}','{{routeSummary}}','现就{{requestItems}}征询意见。']}}),/独立成段/);
});
test('提示词不包含历史模板来源、模板原文、工程专名、参数或联系人',()=>{
 const l=planLetters(highway())[0];l.typeLabel='客户单位私有模板名称';l.templateRef.source='机密来源专名';l.templateRef.bodyBlocks=['历史模板原文机密','{{projectOverview}}','{{routeSummary}}','{{requestItems}}'];const text=JSON.stringify(letterMessages(l));for(const secret of ['客户单位私有模板名称','机密来源专名','历史模板原文机密',l.tokens.projectOverview,l.issuer.contactName||'123notpresent',l.tokens.specialFacts])assert.ok(!text.includes(secret));
});
test('保护段落必须单独且仅出现一次，重复句式和数值不能进入连接文字',()=>{
 const l=planLetters(input())[0],good=['{{projectOverview}}','{{routeSummary}}','{{requestItems}}'];assert.doesNotThrow(()=>applyModel(l,{bodyBlocks:good}));for(const blocks of [[...good,'{{requestItems}}'],[good[0],good[1],'现就{{requestItems}}函复。'],[...good,'现就现就此事函复。'],[...good,'净空99米。'],[...good,'特此函达，盼复。','特此函达，盼复。']])assert.throws(()=>applyModel(l,{bodyBlocks:blocks}));
});
test('编辑多档跨越资料标记正文待重写而不自动调用模型',()=>{
 const i=highway(),t=task(i);t.status='awaiting_confirmation';t.result.letters[0].status='incomplete';t.result.letters[0].bodyBlocks=['已有正文'];const changed=structuredClone(i);changed.agreements[0].crossings[1].clearanceM=28;updateLettersInput(t,{lettersInput:changed,expectedRevision:t.revision});assert.equal(t.result.letters[0].needsRewrite,true);assert.deepEqual(t.result.letters[0].bodyBlocks,['已有正文']);assert.equal(t.result.letters[0].tables[0].rows[1][6],'28');
});
test('模拟补全按跨越行白名单填入数字，保持原资料且不覆盖其他行',()=>{
 const i=highway();delete i.agreements[0].crossings[1].angleDeg;const ids=i.agreements.map(a=>a.id),fields=simulationFields(i,ids),f=fields.find(f=>f.field==='crossings.1.angleDeg');assert.equal(f.type,'number');const output={values:Object.fromEntries(fields.map(f=>[f.key,f.type==='number'?12:f.field==='project.issueDate'?'2026-10-27':'模拟资料'])),attachmentNotes:{[ids[0]]:'模拟附件'}};const filled=applySimulationValues(i,ids,fields,output);assert.equal(filled.agreements[0].crossings[1].angleDeg,12);assert.equal(filled.agreements[0].crossings[0].angleDeg,78);assert.equal(i.agreements[0].crossings[1].angleDeg,undefined);
});
test('结构校验失败仅自动修正一次，二次失败不输出；鉴权失败不重试',async()=>{
 const original=globalThis.fetch;try{
  for(const mode of ['repair','invalid','auth']){let calls=0;const t=task();globalThis.fetch=async()=>{calls++;return mode==='auth'?new Response('{}',{status:401}):response(calls===1||mode==='invalid'?['{{projectOverview}}','{{routeSummary}}','现就{{requestItems}}。']:['{{projectOverview}}','{{routeSummary}}','{{requestItems}}']);};await generateLetters(t,{model:'mock',apiKey:'synthetic',baseUrl:'http://mock'},async()=>{});const l=t.result.letters[0];assert.equal(calls,mode==='auth'?1:2);if(mode==='repair'){assert.equal(l.generation.promptVersion,'letters-paragraphs-v2');assert.deepEqual(l.generation.attempts.map(a=>a.passed),[false,true]);assert.ok(l.bodyBlocks.length);}else{assert.equal(l.status,'failed');assert.deepEqual(l.bodyBlocks,[]);assert.match(l.error,mode==='auth'?/鉴权失败/:/独立成段/);}}
 }finally{globalThis.fetch=original;}
});

test('平台英文类型与已提供的概况、路径、历史意见、多档参数原样接入',()=>{
 const c=structuredClone(SAMPLE);c.project.overview='平台已确认的工程概况';c.routes[0].summary='平台已确认的路径描述';Object.assign(c.agreements[0],{type:'highway',facts:{facilityName:'模拟高速'},crossings:[{...row}],previousLetter:'已提供的前次函件意见',changeSummary:'已提供的调整原因'});
 const i=createLettersInput(c,c.routes[0]);assert.equal(i.project.overview,c.project.overview);assert.equal(i.route.summary,c.routes[0].summary);assert.equal(i.agreements[0].type,'highway');assert.deepEqual(i.agreements[0].crossings,c.agreements[0].crossings);assert.equal(i.agreements[0].previousLetter,c.agreements[0].previousLetter);i.agreements[0].crossings[0].spanStart='NEW';assert.equal(c.agreements[0].crossings[0].spanStart,'NA1');
});
