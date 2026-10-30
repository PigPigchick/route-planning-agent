import {test} from 'node:test';
import assert from 'node:assert/strict';
import {registerContext} from './backend/context-store.mjs';
import {SAMPLE,validateContext} from './dist/engine.mjs';
import {createLettersInput} from './dist/letters-core.mjs';
import {letterContext} from './dist/letter-table.mjs';

const letterInput=()=>createLettersInput(SAMPLE,SAMPLE.routes[0]);

test('编辑征询函工程后建立独立运行快照，不覆盖原工程资料或任务关联',()=>{
 const contexts={},input=letterInput(),first=registerContext(contexts,letterContext(input));
 const original=structuredClone(first.entry),task={contextId:first.entry.id};
 input.project.name='修改后的工程名称';input.route.summary='修改后的路径说明';input.agreements[0].unit='修改后的收函单位';
 const next=registerContext(contexts,letterContext(input));
 assert.equal(first.entry.revision,1);assert.equal(next.created,true);assert.equal(next.entry.revision,2);
 assert.notEqual(next.entry.id,first.entry.id);assert.deepEqual(contexts[task.contextId],original);
 assert.equal(next.entry.context.project.version,first.entry.context.project.version);
 input.project.name='尚未提交的再次编辑';assert.equal(next.entry.context.project.name,'修改后的工程名称');
});

test('重新提交任一历史快照或仅调整对象字段顺序时复用记录，重启后仍有效',()=>{
 let contexts={};const firstContext=letterContext(letterInput());
 const first=registerContext(contexts,firstContext),changed=structuredClone(firstContext);changed.project.overview='新的工程概况';
 const second=registerContext(contexts,changed);
 contexts=JSON.parse(JSON.stringify(contexts));
 const reordered=Object.fromEntries(Object.entries(changed).reverse());
 assert.equal(registerContext(contexts,reordered).entry.id,second.entry.id);
 assert.equal(registerContext(contexts,firstContext).entry.id,first.entry.id);
 assert.equal(registerContext(contexts,firstContext).created,false);assert.equal(Object.keys(contexts).length,2);
});

test('兼容没有修订号的旧快照；完整GIS工程仍要求使用新业务版本',()=>{
 const contexts={old:{id:'old',context:structuredClone(SAMPLE)}};
 const changed=structuredClone(SAMPLE);changed.routes[0].length++;
 assert.throws(()=>registerContext(contexts,changed),/同一工程快照不可覆盖/);
 const letters=registerContext(contexts,letterContext(letterInput()));assert.equal(letters.entry.revision,2);
 assert.deepEqual(contexts.old.context,SAMPLE);
 changed.project.version='v2';assert.equal(registerContext(contexts,changed).created,true);
});

test('待补单位不会使运行快照注册失败，缺项留给逐函检查且不伪造单位',()=>{
 const input=letterInput();input.agreements[0].unit='';
 const context=letterContext(input);assert.doesNotThrow(()=>validateContext(context));
 assert.equal(registerContext({},context).entry.context.agreements[0].unit,'');
 context.agreements[0].unit=123;assert.throws(()=>validateContext(context),/协议清单无效/);
});
