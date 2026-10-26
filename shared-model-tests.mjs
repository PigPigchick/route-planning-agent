import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,stat} from 'node:fs/promises';import os from 'node:os';import path from 'node:path';
import {modelStore,modelConfigSnapshot} from './backend/model.mjs';
import {createDesignTask,generateDesign,applySections} from './backend/design-agents.mjs';
import {SAMPLE,calculate} from './dist/engine.mjs';
test('共享配置未修改沿用同一版本；修改后新快照生效，旧快照不变，空密钥保留',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'tx-model-'));try{
  const store=await modelStore(dir);const first=await store.update({baseUrl:'https://example.test/v1',model:'model-a',apiKey:'synthetic-shared',jsonMode:false,stream:true,thinkingMode:'on'}),snapshot=store.get();
  const same=await store.update({expectedRevision:first.revision,baseUrl:first.baseUrl,model:first.model,apiKey:'',jsonMode:false,stream:true,thinkingMode:'on'});assert.equal(same.unchanged,true);assert.equal(same.revision,first.revision);
  const second=await store.update({expectedRevision:same.revision,model:'model-b',apiKey:''});assert.equal(second.revision,first.revision+1);assert.equal(store.get().apiKey,'synthetic-shared');assert.equal(snapshot.model,'model-a');assert.equal(store.get().model,'model-b');
  await assert.rejects(store.update({expectedRevision:first.revision,model:'stale'}),/其他页面更新/);
  const restored=await modelStore(dir);assert.equal(restored.get().model,'model-b');assert.equal(restored.get().apiKey,'synthetic-shared');assert.equal((await stat(path.join(dir,'model-config.json'))).mode&0o777,0o600);
  assert.ok(!JSON.stringify(second).includes('synthetic-shared'));assert.ok(!JSON.stringify(modelConfigSnapshot(store.get())).includes('synthetic-shared'));assert.deepEqual(second.agentTypes,['comparison','compliance','description','letters']);
 }finally{await rm(dir,{recursive:true,force:true})}
});
test('新配置只有保存后生效，明确清空的密钥在重启后仍为空',async()=>{
 const dir=await mkdtemp(path.join(os.tmpdir(),'tx-model-'));try{const store=await modelStore(dir);await store.update({model:'test',apiKey:'synthetic'});await store.update({clearKey:true});assert.equal((await modelStore(dir)).publicView().keyConfigured,false)}finally{await rm(dir,{recursive:true,force:true})}
});
test('章节校验拒绝编造数值、丢失占位符和调整编号',()=>{
 const s=[{id:'x',tokens:{facts:'42.6 km'}}];assert.equal(applySections(s,{sections:[{id:'x',bodyBlocks:['依据资料，{{facts}}']} ]})[0].text,'依据资料，42.6 km');
 assert.throws(()=>applySections(s,{sections:[{id:'x',bodyBlocks:['{{facts}}，共99公里']}]}));assert.throws(()=>applySections(s,{sections:[{id:'y',bodyBlocks:['{{facts}}']}]}));assert.throws(()=>applySections(s,{sections:[{id:'x',bodyBlocks:['资料已齐全']}]}));
});
test('三个智能体均调用同一配置，比选先生成路径描述，数值和缺项保持原值',async()=>{
 const original=globalThis.fetch,calls=[];
 globalThis.fetch=async(url,opts)=>{const b=JSON.parse(opts.body),m=JSON.parse(b.messages[1].content);calls.push({model:b.model,authorization:opts.headers.Authorization,type:m.agentType});const sections=m.sections.map(s=>({id:s.id,bodyBlocks:s.allowedPlaceholders}));return new Response(JSON.stringify({model:b.model,choices:[{finish_reason:'stop',message:{content:JSON.stringify({sections})}}]}))};
 try{const config={baseUrl:'https://example.test/v1',apiKey:'synthetic',model:'shared-test',jsonMode:true,revision:7};
  for(const agentType of ['description','compliance','comparison']){
   const t=createDesignTask(SAMPLE,{agentType,routeIds:agentType==='comparison'?['A','B','C']:['A']},'llm');assert.equal(t.status,'running');await generateDesign(t,SAMPLE,config,async()=>{});assert.equal(t.status,'awaiting_confirmation');assert.equal(t.generation.model,'shared-test');assert.equal(t.generation.configRevision,7);
   if(agentType==='comparison'){assert.equal(t.dependencies[0].agentType,'description');assert.equal(t.result.ranked.find(r=>r.id==='A').calc.total,calculate(SAMPLE.routes[0]).total);assert.notEqual(t.result.recommended,'C');assert.match(t.result.descriptions[0].text,/42.6/);}
   if(agentType==='compliance')assert.match(t.result.text,/缺少|缺失|尚不具备/);
  }
  assert.deepEqual(calls.map(c=>c.type),['description','compliance','description','comparison']);assert.ok(calls.every(c=>c.model==='shared-test'&&c.authorization==='Bearer synthetic'));
 }finally{globalThis.fetch=original}
});
test('模型失败明确失败，不将模板冒充大模型结果',async()=>{
 const original=globalThis.fetch;globalThis.fetch=async()=>new Response('{}',{status:401});try{const t=createDesignTask(SAMPLE,{agentType:'description',routeIds:['A']},'llm');await generateDesign(t,SAMPLE,{baseUrl:'https://example.test/v1',model:'test',apiKey:'synthetic'},async()=>{});assert.equal(t.status,'failed');assert.match(t.error,/鉴权失败/);assert.ok(t.result.chapters.every(c=>c.text.startsWith('生成失败')))}finally{globalThis.fetch=original}
});
