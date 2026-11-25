import assert from 'node:assert/strict';
import {test} from 'node:test';
import {comparisonReferencePattern,comparisonSourcePattern} from './backend/knowledge-text.mjs';
import {knowledgeStore} from './backend/knowledge.mjs';

const reference=new RegExp(comparisonReferencePattern,'i');
const source=new RegExp(comparisonSourcePattern,'i');

test('区分首次征询和多方案或调整后历史参考',()=>{
 const unsuitable=[
  '本次采用中方案（推荐方案）',
  '按北方案路径征询意见',
  '现就方案二走向组织协调',
  '拟提供三个路径方案供比较',
  '现有多个可选的线路路径方案',
  'A、B方案与备选线位方案',
  '对走廊调整后的线路进行再次征询',
  '关于重新征询紫金段优化调整路径方案意见的函',
  '现将优化设计方案报请核对',
  '关于路线方案比选的情况说明',
 ];
 for(const value of unsuitable)assert.match(value,reference);
 assert.match('历史档案/怀集调整后/发函正文.docx',source);
 assert.match('历史档案\\怀集调整后\\发函正文.docx',source);
 for(const value of ['向韶关市林业局征询本次路径方案意见','中方案社区用地关系','线路方案一致','实施中方案尚需完善','申请核查东方案山路口与拟建线路空间关系','线路需要跨越两个河道','项目计划在工期调整后开工']){
  assert.doesNotMatch(value,reference);assert.doesNotMatch(value,source);
 }
});

test('首函和未授权的后续函件检索前排除整个历史来源，授权改线函可查比较资料',async()=>{
 const calls=[];
 const pool={async query(sql,params){
  if(sql.includes('FROM tx_resources'))return {rows:[{payload:{enabled:true}}]};
  calls.push({sql,params});return {rowCount:0,rows:[]};
 }};
 const store=await knowledgeStore({pool},{get:()=>({baseUrl:'http://127.0.0.1:9/v1',apiKey:''})});
 const input={project:{id:'test',version:'v1'}};
 const letter={type:'general',typeLabel:'一般路径征询',templateRef:{id:'general',name:'一般路径征询',version:'1.0'},tokens:{requestItems:'录机房线路路径意见'}};
 for(const [round,allowAlternatives,filtered] of [['first',undefined,true],['first',true,true],['repeat',true,true],['revised',false,true],['revised',true,false]]){
  const result=await store.forLetter({...letter,round,allowAlternatives},input);
  assert.equal(result.status,'empty');
  const {sql,params}=calls.at(-1);
  assert.match(sql,/COALESCE\(d\.metadata->>'direction','outgoing'\)='outgoing'/);
  assert.equal(sql.includes("d.metadata->>'sources'"),filtered);
  if(filtered){
   assert.deepEqual(params.slice(-2),[comparisonReferencePattern,comparisonSourcePattern]);
   assert.match(sql,/t\.content,t\.index_text/);
   assert.match(sql,/sibling\.document_id=d\.id/);
  }
 }
 assert.equal(calls.length,5);
});
