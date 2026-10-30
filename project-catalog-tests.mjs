import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {initialProjectCatalog,rememberProject,projectKey,projectLabel,newProjectInput,archiveProject,restoreProject} from './dist/project-catalog.mjs';
import {emptyWorkspace,currentProjectInput} from './dist/workspace-state.mjs';
import {letterContext} from './dist/letter-table.mjs';
import {validateLettersInput} from './dist/letters-core.mjs';
const context=(id,name,version='v1')=>({...structuredClone(SAMPLE),project:{...SAMPLE.project,id,name,version,isDemo:false}});
test('旧单工程升级为工程目录，空白工作区保持空白，多次保存不重复',()=>{
 const a=context('A','工程甲'),initial=initialProjectCatalog({context:a,routeId:'B'},a);
 assert.equal(initial.length,1);assert.equal(initial[0].routeId,'B');
 assert.equal(rememberProject(initial,a,'C',['C']).length,1);
 assert.deepEqual(initialProjectCatalog(null,emptyWorkspace()),[]);
});
test('不同工程和同工程不同快照分开保留；名称在选项中完整显示且同名可区分',()=>{
 const a=context('A','名称很长的500千伏工程'),b=context('B','工程乙');let entries=rememberProject([],a,'A',['A']);
 entries=rememberProject(entries,b,'B',['B']);entries=rememberProject(entries,context('A',a.project.name,'v2'),'C',['C']);
 assert.equal(entries.length,3);assert.ok(projectLabel(entries[0],entries).includes(a.project.name));assert.ok(projectLabel(entries[0],entries).includes('v1'));
 assert.notEqual(projectKey(a),projectKey(b));assert.equal(entries[0].routeId,'A');
 const restored=initialProjectCatalog({projects:entries,routeId:'B'},b);assert.equal(restored.length,3);
});
test('新建工程不继承上一工程资料，工程清单可为空，必填参数明确提示',()=>{
 const fields={name:'工程乙',id:'B',version:'v1',routeId:'P01',overview:'乙概况',routeSummary:'乙路径',issuer:'乙单位'};
 const input=newProjectInput(fields);validateLettersInput(input,{allowEmpty:true});assert.deepEqual(input.agreements,[]);assert.equal(input.project.contactName,'');assert.equal(input.project.issuer,'乙单位');assert.equal(input.project.isDemo,false);
 assert.throws(()=>newProjectInput({...fields,name:' '}),/工程名称/);assert.throws(()=>newProjectInput({...fields,routeId:''}),/路径编号/);
});
test('工程切换及序列化恢复后各自读取工作副本，附件和勾选不串工程',()=>{
 const a=newProjectInput({name:'甲',id:'A',version:'v1',routeId:'P01'}),b=newProjectInput({name:'乙',id:'B',version:'v1',routeId:'P01'});
 a.project.issuer='甲发函单位';a.route.summary='甲路径';
 const entries=new Map([['tx-letters-v2-A-v1-P01',JSON.stringify({input:a,selected:['甲单位']})],['tx-letters-v2-B-v1-P01',JSON.stringify({input:b,selected:[]})]]),storage={getItem:key=>entries.get(key)||null};
 let catalog=rememberProject([],letterContext(a),'P01',[]);catalog=rememberProject(catalog,letterContext(b),'P01',[]);
 const restored=JSON.parse(JSON.stringify(catalog));assert.equal(currentProjectInput(restored[0].context,'P01',storage).project.issuer,'甲发函单位');assert.equal(currentProjectInput(restored[1].context,'P01',storage).project.issuer,'');
});
test('删除工程移出列表，刷新后仍可恢复原工程路径及勾选，不影响其他工程',()=>{
 const a=context('A','工程甲'),b=context('B','工程乙');
 const catalog=rememberProject(rememberProject([],a,'B',['B'] ),b,'A',['A']);
 const deleted=archiveProject(catalog,[],projectKey(a),'2026-10-30T00:00:00Z');
 assert.equal(deleted.projects.length,1);assert.equal(deleted.projects[0].context.project.id,'B');
 assert.equal(deleted.deletedProjects[0].routeId,'B');assert.deepEqual(deleted.deletedProjects[0].selected,['B']);
 const stored=JSON.parse(JSON.stringify(deleted));
 assert.equal(initialProjectCatalog(stored,emptyWorkspace()).length,1);
 const restored=restoreProject(stored.projects,stored.deletedProjects,projectKey(a));
 assert.equal(restored.deletedProjects.length,0);assert.equal(restored.projects.length,2);
 assert.deepEqual(restored.projects.find(x=>x.key===projectKey(a)).context,a);
 assert.throws(()=>restoreProject(restored.projects,deleted.deletedProjects,projectKey(a)),/已存在/);
});
