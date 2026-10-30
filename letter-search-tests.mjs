import {test} from 'node:test';
import assert from 'node:assert/strict';
import {rankAgreements,searchSummary} from './dist/letter-search.mjs';

const agreements=[
 {id:'A',unit:'大埔县人民政府',scope:'大埔县',points:'协调工程路径'},
 {id:'B',unit:'林业局',scope:'大埔县',points:'核对林地与保护区'},
 {id:'C',unit:'林业局',scope:'梅县区',points:'核对林地与保护区'},
 {id:'D',unit:'水务局',scope:'梅县区',points:'河道跨越',type:'river'},
 {id:'E',unit:'梅县区人民政府',scope:'梅县区',points:'协调工程路径'},
];
test('组合关键词优先匹配对应区段与单位，重复单位保留各自原始索引',()=>{
 const rows=rankAgreements(agreements,'梅县 林业');
 assert.equal(rows[0].agreement.id,'C');assert.equal(rows[0].index,2);
 assert.equal(rankAgreements(agreements,'大埔 林业')[0].agreement.id,'B');
 assert.equal(rankAgreements(agreements,'梅县林业局')[0].agreement.id,'C');
 assert.equal(rankAgreements(agreements,'河道跨越')[0].agreement.id,'D');
 assert.equal(rankAgreements(agreements,'航道',{river:'河道与航道征询'})[0].agreement.id,'D');
});
test('完整单位名称排首位，相似文本也可匹配，完全无关的查询不改变原顺序',()=>{
 assert.equal(rankAgreements(agreements,'大埔县人民政府')[0].agreement.id,'A');
 const fuzzy=rankAgreements(agreements,'大埔县人民政俯');assert.equal(fuzzy[0].agreement.id,'A');assert.ok(fuzzy[0].score>0);
 const none=rankAgreements(agreements,'ZZZ找不到');assert.deepEqual(none.map(x=>x.agreement.id),agreements.map(x=>x.id));
 assert.match(searchSummary(none,'ZZZ找不到'),/未找到匹配/);
});
test('搜索不修改原数组、事实或勾选；清空恢复原始顺序，同分稳定',()=>{
 const before=structuredClone(agreements),selected=['C'];
 const rows=rankAgreements(agreements,'林业');assert.deepEqual(rows.slice(0,2).map(x=>x.agreement.id),['B','C']);
 assert.deepEqual(agreements,before);assert.deepEqual(selected,['C']);
 assert.deepEqual(rankAgreements(agreements,'  ').map(x=>x.index),[0,1,2,3,4]);
 assert.equal(searchSummary(rankAgreements(agreements,'林业'),'林业'),'匹配 2 项 · 按相关度排序');
 assert.equal(searchSummary(rows,''),'');
});
