import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createLetterResources,updateLetterResources,recommendRecipients,validateRecipientReferences} from './backend/letter-resources.mjs';
import {recordCorrespondence} from './backend/letter-ledger.mjs';
import {createLettersTask} from './backend/letters-agent.mjs';
import {createLettersInput,updateLettersInput,reviewLetter,agreementSelectionSignature,resolveLetterTemplate} from './dist/letters-core.mjs';
import {SAMPLE} from './dist/engine.mjs';
const mutate=(r,b)=>updateLetterResources(r,{expectedRevision:r.revision,actor:'测试维护人',...b});
const directory={areas:[{code:'DEMO',name:'模拟区划',source:'测试目录'}],authorities:[{id:'UNIT',unit:'模拟主管单位',types:['general'],areaCodes:['DEMO'],featureIds:[],relationTypes:['涉及'],basis:'测试用管理归属依据',enabled:true}]};
const relation={id:'REL',projectId:SAMPLE.project.id,routeId:'A',routeVersion:SAMPLE.project.version,segmentId:'SEG',scope:'T001—T002',featureId:'FEATURE',featureName:'模拟对象',type:'general',relationType:'涉及',areaCodes:['DEMO'],points:'征询测试事项',evidence:'测试平台数据和触发依据',reviewed:true};
function fixture(resources){const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);input.agreements=input.agreements.slice(0,1);input.agreements[0].attachments=[];input.templateConfirmed=true;Object.assign(input.project,{issueDate:'2026-10-25',issuer:'测试单位',contactName:'测试人',contactPhone:'测试电话',replyAddress:'测试地址'});return {input,task:createLettersTask(SAMPLE,{routeIds:['A'],options:{mode:'template',lettersInput:input,templateCatalog:resources?.templates}},{} )};}

test('模板新增、修改和启停递增版本，历史任务锁定旧模板且维护操作原子校验',()=>{
 let r=createLetterResources();r=mutate(r,{action:'save-template',template:{...r.templates[0],name:'自定义模板'}});const t=r.templates.at(-1);assert.equal(t.version,'1.0');
 const {input}=fixture();input.agreements[0].templateId=t.id;
 const old=createLettersTask(SAMPLE,{routeIds:['A'],options:{mode:'template',lettersInput:structuredClone(input),templateCatalog:structuredClone(r.templates)}},{});const before=structuredClone(old.result.letters[0]);
 r=mutate(r,{action:'save-template',id:t.id,template:{...t,name:'新版名称'}});assert.equal(r.templates.at(-1).version,'2.0');assert.equal(r.templates.at(-1).history[0].name,t.name);
 r=mutate(r,{action:'set-template-enabled',id:t.id,enabled:false});assert.equal(r.templates.at(-1).version,'3.0');
 assert.throws(()=>createLettersTask(SAMPLE,{routeIds:['A'],options:{mode:'template',lettersInput:input,templateCatalog:r.templates}},{}),/已停用/);
 const changed=structuredClone(input);changed.project.contactName='新联系人';updateLettersInput(old,{lettersInput:changed,expectedRevision:old.revision},{});assert.equal(old.result.letters[0].templateRef.version,'1.0');assert.deepEqual(old.result.letters[0].bodyBlocks,before.bodyBlocks);
 const snapshot=JSON.stringify(r);assert.throws(()=>mutate(r,{action:'save-template',id:t.id,template:{...t,bodyBlocks:['遗漏事实','非法内容','结束']}}),/必要占位符/);assert.equal(JSON.stringify(r),snapshot);
 assert.throws(()=>updateLetterResources(r,{expectedRevision:1,actor:'测试人',action:'set-template-enabled',id:t.id,enabled:true}),/版本已变化/);
});

test('单位建议要求类型、关系和目录依据匹配，区分旧版本、多候选、过期及未确认来源',()=>{
 let r=mutate(createLetterResources(),{action:'import-directory',...directory});r=mutate(r,{action:'import-relations',relations:[relation,{...relation,id:'OLD',routeVersion:'v0'}, {...relation,id:'UNREVIEWED',reviewed:false}]});
 const {input}=fixture();let result=recommendRecipients(r,input);assert.equal(result.excludedVersionCount,1);assert.equal(result.items[0].candidates[0].unit,'模拟主管单位');assert.equal(result.items[0].status,'待人工确认');assert.equal(result.items[1].status,'上游关系待确认');
 r.authorities.push({...r.authorities[0],id:'OTHER',unit:'另一个候选'});assert.equal(recommendRecipients(r,input).items[0].status,'多个候选待确认');
 r.authorities.forEach(a=>a.validTo='2020-01-01');assert.equal(recommendRecipients(r,input).items[0].status,'缺少单位映射');
 assert.throws(()=>mutate(r,{action:'import-directory',areas:directory.areas,authorities:[{...directory.authorities[0],basis:''}]}),/依据/);
});

test('目录检查能阻断错误名称、无效区划和不适用类型；未关联目录明确需人工核对',()=>{
 const r=mutate(createLetterResources(),{action:'import-directory',...directory}),{input,task}=fixture();const a=input.agreements[0],l=task.result.letters[0];
 validateRecipientReferences(l,input,a,r);assert.ok(l.validationChecks.every(c=>c.status==='manual'));
 Object.assign(a,{authorityId:'UNIT',adminAreaCodes:['UNKNOWN'],unit:'错误名称'});validateRecipientReferences(l,input,a,r);assert.ok(l.missingFields.some(x=>x.field==='authorityId'&&x.blocking));assert.ok(l.missingFields.some(x=>x.field==='adminAreaCodes'));
});

test('发出/回复登记与复核分离，约束日期、状态更正及修订，资料更新保留历史',()=>{
 const {task,input}=fixture();let l=task.result.letters[0];l.missingFields=[];l.status='draft';
 const b={letterId:l.id,expectedRevision:task.revision,actor:'测试人',record:{state:'已发出待回复',sentAt:'2026-10-25'}};
 assert.throws(()=>recordCorrespondence(task,b),/人工复核/);reviewLetter(task,{action:'confirm',letterId:l.id,expectedRevision:l.revision,reviewer:'QA',note:'测试核对'});
 recordCorrespondence(task,{...b,expectedRevision:task.revision});assert.equal(l.status,'confirmed');assert.equal(l.correspondence.state,'已发出待回复');
 assert.throws(()=>recordCorrespondence(task,{...b,expectedRevision:task.revision,record:{state:'已回复',sentAt:'2026-10-25',replyAt:'2026-10-24',replySummary:'测试回复'}}),/早于/);
 recordCorrespondence(task,{...b,expectedRevision:task.revision,record:{state:'已回复',sentAt:'2026-10-25',replyAt:'2026-10-25',replySummary:'要求补充资料'}});assert.equal(l.correspondenceHistory.length,2);
 assert.throws(()=>recordCorrespondence(task,{...b,expectedRevision:task.revision,record:{state:'未发出'}}),/更正原因/);
 const next=structuredClone(input);next.project.issueDate='2026-10-26';updateLettersInput(task,{lettersInput:next,expectedRevision:task.revision},{});l=task.result.letters[0];assert.equal(l.correspondence.replySummary,'要求补充资料');assert.equal(l.correspondenceHistory.length,2);
 assert.throws(()=>recordCorrespondence({...task,simulation:true},b),/模拟/);
});

test('声明清单确认能力的调用必须提供当前选中项确认，单位或事项变化使签名失效',()=>{
 const {input}=fixture(),ids=input.agreements.map(a=>a.id),options={mode:'llm',lettersInput:input,agreementIds:ids,requireListConfirmation:true};
 assert.throws(()=>createLettersTask(SAMPLE,{routeIds:['A'],options},{}),/尚未确认/);
 options.listConfirmation={reviewer:'清单确认人',note:'按业务资料确认',signature:agreementSelectionSignature(input,ids)};
 assert.equal(createLettersTask(SAMPLE,{routeIds:['A'],options},{}).listConfirmation.reviewer,'清单确认人');
 input.agreements[0].unit='更换收函单位';assert.throws(()=>createLettersTask(SAMPLE,{routeIds:['A'],options},{}),/资料已变化/);
});

test('模板按单位编号与协议类型优先匹配，多个专用模板需明确选择，禁止跨单位误用',()=>{
 const r=createLetterResources(),base=r.templates[0],special={...base,id:'SPECIAL',unitIds:['UNIT'],name:'单位专用'};r.templates.push(special);
 const a={type:'general',authorityId:'UNIT'};assert.equal(resolveLetterTemplate(a,r.templates).id,'SPECIAL');assert.equal(resolveLetterTemplate({type:'general'},r.templates).id,'general');
 r.templates.push({...special,id:'SPECIAL-2'});assert.throws(()=>resolveLetterTemplate(a,r.templates),/多个适用模板/);assert.equal(resolveLetterTemplate({...a,templateId:'SPECIAL'},r.templates).id,'SPECIAL');assert.throws(()=>resolveLetterTemplate({type:'general',authorityId:'OTHER',templateId:'SPECIAL'},r.templates),/不适用于/);
});
