import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {letterContext} from './dist/letter-table.mjs';
import {readLettersDocument} from './dist/letter-input-document.mjs';

test('函件JSON和平台工程JSON均可读取，保留发函信息及专项事实且不改原文档',()=>{
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);
 Object.assign(input.project,{issuer:'测试发函单位',issueDate:'2026-10-29',contactName:'测试联系人'});
 input.agreements[0].facts={facilityName:'原始对象'};
 const original=structuredClone(input);assert.deepEqual(readLettersDocument(input),input);assert.deepEqual(input,original);
 const context=letterContext(input),before=structuredClone(context),result=readLettersDocument(context);
 assert.equal(result.schemaVersion,'letters-v2');assert.equal(result.route.id,input.route.id);assert.equal(result.project.issuer,input.project.issuer);
 assert.equal(result.project.issueDate,input.project.issueDate);assert.deepEqual(result.agreements[0].facts,input.agreements[0].facts);assert.deepEqual(context,before);
});
test('多路径工程必须指定有效路径，真实缺少字段时说明具体缺项',()=>{
 assert.throws(()=>readLettersDocument(SAMPLE),/先选择/);
 assert.equal(readLettersDocument(SAMPLE,{routeId:'B'}).route.id,'B');
 assert.throws(()=>readLettersDocument({project:{name:'有名称的工程'}}),/工程编号、工程版本/);
});
