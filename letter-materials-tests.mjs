import {test} from 'node:test';import assert from 'node:assert/strict';
import {materialCheckItems,materialsChecklistMarkdown,materialsChecklistData} from './dist/letter-materials.mjs';
import {extractSourceFacts,fillMissingFromSource,matchSourceAttachment,attachmentKindFromName} from './backend/letter-source-audit.mjs';
import {SAMPLE} from './dist/engine.mjs';import {createLettersInput} from './dist/letters-core.mjs';
test('未录入、未关联及待确认分开，不将未关联文件认定为未提供',()=>{
 const l={agreementIds:['X'],unit:'待确认',missingFields:[{field:'unit',label:'收函单位',blocking:true},{field:'attachments.路径图',label:'路径图实际文件'},{field:'templateConfirmed',label:'模板业务核对'},{field:'attachments.1.version',label:'版本冲突',blocking:true}]};const items=materialCheckItems(l);assert.deepEqual(items.map(x=>x.category),['信息未录入','附件待关联','待核对','待核对']);assert.match(items[1].state,/不能判定资料未提供/);assert.match(items[0].action,/平台已有协议清单/);assert.match(items[2].action,/不是需要另行提供的资料/);
 const report=materialsChecklistMarkdown([l],{projectName:'测试|工程',routeId:'A',version:'v1',stale:true});assert.match(report,/测试\\\|工程/);assert.match(report,/上一次已同步/);assert.match(report,/核对已交付ZIP/);assert.ok(!report.includes('甲方未提供路径图'));
});
// 所有坐标、河道、电话与单位均为虚构测试资料。
test('河道杆塔含加号或短编号、原文坐标按字符串提取，不误配电话号码',()=>{
 const source='GJA2+1-GJA2+2段线路跨越模拟河道甲。\nCGCS2000坐标系\nGJA2+1\n412345.1234，2345678.1234\nGJA2+2\n412399.5678，2345890.5678\n电话：13000000000';const e=extractSourceFacts(source,{type:'water'});assert.equal(e.crossings[0].spanStart,'GJA2+1');assert.equal(e.crossings[0].spanEnd,'GJA2+2');assert.equal(e.crossings[0].coordinateSystem,'CGCS2000');assert.equal(e.coordinates.length,2);assert.equal(e.coordinates[0].x,'412345.1234');assert.equal(extractSourceFacts('JA4-JA5段线路跨越模拟河道乙。',{type:'water'}).crossings[0].spanEnd,'JA5');assert.equal(extractSourceFacts(source,{type:'highway'}).crossings.length,0);
});
test('补录仅填空值，不覆盖已有事实，不自动猜收函单位或确认资料',()=>{
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);input.agreements=input.agreements.slice(0,1);const a=input.agreements[0];a.type='water';a.unit='';a.facts={spanStart:'已确认塔号'};const source='JA4-JA5段线路跨越模拟河道乙。\n模拟电力设计研究院\n2023年6月20日';const e=extractSourceFacts(source,{type:'water'});const r=fillMissingFromSource(input,a.id,e);assert.equal(r.input.agreements[0].facts.spanStart,'已确认塔号');assert.equal(r.input.agreements[0].facts.spanEnd,'JA5');assert.equal(r.input.project.issuer,'模拟电力设计研究院');assert.equal(r.input.agreements[0].unit,'');assert.equal(r.conflicts.length,1);assert.equal(input.project.issuer,'');assert.equal(input.templateConfirmed,r.input.templateConfirmed);
});
test('附件精确匹配限定工程范围，同名不同内容待核对，回复文件不充当路径图',()=>{
 const files=[{path:'工程A/复函/附件：路径图.pdf',sha256:'a'},{path:'工程B/路径图.pdf',sha256:'b'},{path:'工程A/路径图的复函.pdf',sha256:'c'}];const m=matchSourceAttachment('路径图',files,{scopePrefix:'工程A/'});assert.equal(m.status,'matched');assert.equal(m.file.sha256,'a');assert.throws(()=>matchSourceAttachment('路径图',files),/限定/);assert.equal(matchSourceAttachment('路径图',[...files,{path:'工程A/路径图.dwg',sha256:'z'}],{scopePrefix:'工程A/'}).status,'ambiguous');assert.equal(matchSourceAttachment('坐标表',files,{scopePrefix:'工程A/'}).status,'unresolved');assert.match(matchSourceAttachment('坐标表',files,{scopePrefix:'工程A/'}).reason,/不能据此认定未提供/);assert.equal(attachmentKindFromName('线路路径地形图（1:4万）'),'路径图');assert.equal(attachmentKindFromName('路径盖章图'),'路径图');assert.equal(attachmentKindFromName('线路转角位中心点坐标表'),'坐标表');
});

test('Word清单保持单位、协议编号、分类和补充建议，普通中文不做Markdown转义',()=>{
 const letters=[{agreementIds:['L-1','L-2'],unit:'核对单位甲',status:'failed',error:'输入资料有冲突',missingFields:[{field:'unit',label:'收函单位',blocking:true},{field:'attachments.1',label:'路径图实际文件'}]}];
 const before=structuredClone(letters),data=materialsChecklistData(letters,{projectName:'工程甲|乙',routeId:'P01',version:'v2',stale:true,simulation:true,exportedAt:'2026-10-30T00:00:00Z'});
 assert.equal(data.itemCount,2);assert.equal(data.projectName,'工程甲|乙');assert.ok(data.stale&&data.simulation);
 assert.deepEqual(data.groups[0].agreementIds,['L-1','L-2']);assert.equal(data.groups[0].error,'输入资料有冲突');
 assert.deepEqual(data.groups[0].items,materialCheckItems(letters[0]));assert.deepEqual(letters,before);
 assert.equal(materialsChecklistData([]).itemCount,0);
});
