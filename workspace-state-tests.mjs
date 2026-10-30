import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {emptyWorkspace,emptyLettersInput,initialWorkspace,currentProjectInput} from './dist/workspace-state.mjs';
import {workbookToLetters} from './dist/letter-table.mjs';

const storage=entries=>({getItem:key=>entries.get(key)||null});
const source=()=>({...structuredClone(SAMPLE),project:{...SAMPLE.project,id:'EXCEL-TEST',name:'已导入工程'}});
test('无导入和旧版自动演示工作区保持空白，明确导入的示例可正常保留',()=>{
 const db=storage(new Map());
 assert.deepEqual(initialWorkspace(null,db),emptyWorkspace());
 assert.deepEqual(initialWorkspace({context:structuredClone(SAMPLE)},db),emptyWorkspace());
 assert.deepEqual(initialWorkspace({context:structuredClone(SAMPLE),projectImported:true},db),SAMPLE);
 assert.deepEqual(initialWorkspace({context:source(),projectImported:false},db),emptyWorkspace());
});
test('系统重置后的旧缓存不再显示旧工程，清单重置和重新导入则保留工程',()=>{
 const context=source(),entries=new Map();
 const reset={resetAt:'2026-10-29',resetScope:'project',input:emptyLettersInput()};
 for(const route of context.routes)entries.set('tx-letters-v2-'+context.project.id+'-'+context.project.version+'-'+route.id,JSON.stringify(reset));
 assert.deepEqual(initialWorkspace({context},storage(entries)),emptyWorkspace());
 for(const route of context.routes)entries.set('tx-letters-v2-'+context.project.id+'-'+context.project.version+'-'+route.id,JSON.stringify({...reset,resetScope:'agreements'}));
 assert.deepEqual(initialWorkspace({context},storage(entries)),context);
 entries.clear();assert.deepEqual(initialWorkspace({context},storage(entries)),context);
});
test('空白输入不生成演示描述，完整Excel可从空白工作区建立新工程',()=>{
 const input=emptyLettersInput();
 assert.equal(input.project.name,'');assert.equal(input.project.id,'');assert.equal(input.project.version,'');assert.equal(input.route.summary,'');assert.deepEqual(input.agreements,[]);
 const book={sheets:[{name:'工程信息',rows:[['字段','值'],['工程编号','NEW-PROJECT'],['工程名称','新导入测试工程'],['工程版本','v1'],['路径编号','A']]},{name:'协议清单',rows:[['行政区域','部门','征询事项'],['测试区','测试单位','核对路径']]}]};
 const result=workbookToLetters(book,input);
 assert.equal(result.input.project.id,'NEW-PROJECT');assert.equal(result.input.project.name,'新导入测试工程');assert.equal(result.newProject,true);
 assert.equal(input.project.id,'');assert.deepEqual(input.agreements,[]);
});

test('当前工程摘要读取最新编辑资料，隔离其他工程、路径与版本，空工程不回填历史',()=>{
 const context=source(),entries=new Map(),db=storage(entries),routeId='A';
 const key='tx-letters-v2-'+context.project.id+'-'+context.project.version+'-'+routeId;
 const input=currentProjectInput(context,routeId,db);
 Object.assign(input.project,{issuer:'最新发函单位',contactName:'最新联系人',overview:'更新后的工程概况'});input.route.summary='更新后的路径';input.agreements=[];
 entries.set(key,JSON.stringify({input}));
 assert.deepEqual(currentProjectInput(context,routeId,db),input);
 assert.equal(currentProjectInput(context,'B',db).project.issuer,'');
 for(const field of ['id','version']){
  const stale=structuredClone(input);stale.project[field]='其他';entries.set(key,JSON.stringify({input:stale}));
  assert.notEqual(currentProjectInput(context,routeId,db).project.issuer,'最新发函单位');
 }
 assert.deepEqual(currentProjectInput(emptyWorkspace(),'',db),emptyLettersInput());
});
