import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {emptyWorkspace} from './dist/workspace-state.mjs';
import {createAgentSample,shouldShowAgentSample,runAgentSample} from './dist/agent-sample-state.mjs';

test('未导入工程或只有征询函资料时展示三页样例，完整路径工程和征询函页保持真实资料',()=>{
 for(const page of ['comparison','compliance','description']){
  assert.equal(shouldShowAgentSample(emptyWorkspace(),page),true);
  assert.equal(shouldShowAgentSample({contextType:'letters',project:{id:'REAL'}},page),true);
  assert.equal(shouldShowAgentSample(SAMPLE,page),false);
 }
 assert.equal(shouldShowAgentSample(emptyWorkspace(),'letters'),false);
 assert.equal(shouldShowAgentSample(emptyWorkspace(),'overview'),false);
});
test('三页初次打开已有样例指标、合规问题及完整描述章节',()=>{
 const state=createAgentSample();
 assert.equal(state.context.routes.length,3);assert.equal(state.tasks.length,3);
 const result=type=>state.tasks.find(t=>t.agentType===type).result;
 assert.equal(result('comparison').ranked.length,3);assert.ok(result('comparison').recommended);
 assert.ok(result('compliance').issues.length);assert.equal(result('description').chapters.length,4);
 assert.ok(state.tasks.every(t=>t.isSample&&t.id.startsWith('AGENT-SAMPLE-')));
});
test('样例路径勾选、权重及重新运行彼此隔离，不修改原始资料或其他样例实例',()=>{
 const source=structuredClone(SAMPLE),a=createAgentSample(),b=createAgentSample();
 a.selected=['A','B'];a.weights={economy:20,ecology:50,construction:30};
 const task=runAgentSample(a,'comparison');assert.equal(task.result.ranked.length,2);
 assert.deepEqual(task.result.weights,a.weights);assert.equal(a.tasks.length,3);
 a.context.project.name='临时更改';
 assert.deepEqual(SAMPLE,source);assert.equal(b.context.project.name,source.project.name);
 assert.equal(b.selected.length,3);assert.equal(b.weights.economy,50);
 assert.throws(()=>runAgentSample(a,'letters'),/不使用样例任务/);
});
