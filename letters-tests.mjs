import {test} from 'node:test';import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {agreementSelectionSignature,createLettersInput,planLetters,reviewLetter,validateLettersInput} from './dist/letters-core.mjs';
import {findAlternativeWording} from './dist/letter-scenario.mjs';
import {agreementsFromRows} from './dist/letter-table.mjs';
import {createLettersTask,generateLetters} from './backend/letters-agent.mjs';
import {applyModel,letterMessages,chatJSON,previewLetterBody} from './backend/model.mjs';
function input(){return createLettersInput(SAMPLE,SAMPLE.routes[0])}
function task(i=input(),mode='template'){return createLettersTask(SAMPLE,{contextId:'ctx',routeIds:['A'],options:{mode,lettersInput:i}},{})}
test('默认跳过已完成事项，显式选择重新起草并保留提示',()=>{const i=input();i.agreements[0].status='已完成';assert.equal(planLetters(i).length,2);assert.match(planLetters(i,{agreementIds:[i.agreements[0].id]})[0].warnings.join(),/已完成/)});
test('核心输入缺失和附件版本冲突阻断，零数值仍视为已填写',()=>{const i=input();i.agreements[0].unit='';assert.equal(planLetters(i)[0].status,'blocked');i.agreements[1].facts.angleDeg=0;assert.ok(!planLetters(i)[1].missingFields.some(x=>x.field==='facts.angleDeg'));i.agreements[1].facts.clearanceM=-1;assert.throws(()=>validateLettersInput(i));i.agreements[1].facts.clearanceM=0;i.agreements[1].attachments[0].routeVersion='old';assert.equal(planLetters(i)[1].status,'blocked')});
test('缺少实际附件和发函资料不能确认，编辑保留版本检查',()=>{const t=task();assert.throws(()=>reviewLetter(t,{action:'confirm',letterId:'LETTER-1',expectedRevision:1,reviewer:'QA',note:'确认'}),/资料未齐/);reviewLetter(t,{action:'edit',letterId:'LETTER-1',expectedRevision:1,bodyBlocks:['人工核对的描述']});assert.equal(t.result.letters[0].revision,2);assert.equal(t.result.letters[0].edits.length,1);assert.throws(()=>reviewLetter(t,{action:'edit',letterId:'LETTER-1',expectedRevision:1,bodyBlocks:['旧版']}))});
test('大模型只组织占位符，原始数值不进入提示词，输出不得新增数值',()=>{const l=planLetters(input())[0];const messages=JSON.stringify(letterMessages(l));assert.ok(!messages.includes('42.6'));assert.ok(!messages.includes(SAMPLE.project.name));const out={bodyBlocks:['{{projectOverview}}','{{routeSummary}}','{{requestItems}}']};assert.match(applyModel(l,out).join(),/42.6/);assert.throws(()=>applyModel(l,{bodyBlocks:['{{projectOverview}}','{{routeSummary}}','{{requestItems}}','已批准，净空99米']}));assert.throws(()=>applyModel(l,{bodyBlocks:['{{projectOverview}}','{{routeSummary}}','{{wrong}}']}))});
test('大模型未完成不能暴露模板正文，鉴权失败清晰报错且不回显密钥',async()=>{const t=task(input(),'llm');assert.equal(t.result.letters[0].status,'pending');assert.equal(t.result.letters[0].bodyBlocks.length,0);await assert.rejects(chatJSON({model:'test',apiKey:'secret-never-echo',baseUrl:'http://test',jsonMode:true},[],{fetcher:async()=>new Response('secret-never-echo',{status:401})}),e=>/鉴权失败/.test(e.message)&&!e.message.includes('secret-never-echo'))});
test('千问流式协议传入思考开关，仅拼接最终正文并保留用量',async()=>{
 const packets=[{model:'qwen3.8-max',choices:[{index:0,delta:{reasoning_content:'PRIVATE_REASONING_NEVER_STORE'},finish_reason:null}]},{choices:[{index:0,delta:{content:'{"ok":'},finish_reason:null}]},{choices:[{index:0,delta:{content:'true,"说明":"连接正常"}'},finish_reason:null}]},{choices:[{index:0,delta:{},finish_reason:'stop'}]},{choices:[],usage:{total_tokens:12}}];
 const bytes=new TextEncoder().encode(packets.map(p=>'data: '+JSON.stringify(p)+'\r\n\r\n').join('')+'data: [DONE]\r\n\r\n');
 const r=await chatJSON({model:'qwen3.8-max',baseUrl:'https://example.test/v1',apiKey:'synthetic',jsonMode:false,stream:true,thinkingMode:'on'},[],{fetcher:async(url,opts)=>{const b=JSON.parse(opts.body);assert.equal(b.enable_thinking,true);assert.equal(b.stream,true);assert.equal(b.stream_options.include_usage,true);assert.equal(b.response_format,undefined);return new Response(new ReadableStream({start(c){for(let i=0;i<bytes.length;i+=7)c.enqueue(bytes.slice(i,i+7));c.close()}}))}});
 assert.deepEqual(r.output,{ok:true,说明:'连接正常'});assert.equal(r.usage.total_tokens,12);assert.equal(r.stream,true);assert.ok(!JSON.stringify(r).includes('PRIVATE_REASONING'));
});
test('流式中途断开不会作为完整成功结果',async()=>{
 await assert.rejects(chatJSON({model:'test',baseUrl:'https://example.test/v1',apiKey:'synthetic',stream:true},[],{fetcher:async()=>new Response('data: {"choices":[{"index":0,"delta":{"content":"{\\"ok\\":true}"}}]}\n\n')}),/中断/);
});

test('首函中性化单一路径标识，保留里程，原始输入和历史字段保留在任务内部',()=>{
 const i=input(),a=i.agreements[0];
 i.project.overview='推荐方案路径长度约94.5km，涉及两个河道。';
 i.route.summary='本次采用中方案（推荐方案），跨越小金河。';
 a.points='请核查本次路径方案一般征询范围。';
 a.previousLetter='前次征询方案一和方案二。';
 a.changeSummary='前次调整资料。';
 const l=planLetters(i)[0];
 assert.match(l.text,/本次征询路径长度约94\.5km/);
 assert.match(l.text,/跨越小金河/);
 assert.equal(findAlternativeWording(l.text),'');
 assert.equal(l.tokens.historySummary,'');
 assert.match(i.route.summary,/中方案（推荐方案）/);
});

test('单路径函件识别实际方案编号与比较，保留合法的路径方案表述',()=>{
 for(const value of ['本次路径方案一般征询','路径方案一致','其中方案范围需核对','两处河道跨越'])assert.equal(findAlternativeWording(value),'',value);
 for(const value of ['方案一采用','方案一为','方案Ａ路径','推荐的方案','优化调整方案','中方案（推荐方案）'])assert.ok(findAlternativeWording(value),value);
 const i=input(),a=i.agreements[0];
 i.route.summary='方案一路径长10km，方案二采用另一走廊。';
 let l=planLetters(i)[0];
 assert.equal(l.status,'blocked');
 assert.deepEqual(l.bodyBlocks,[]);
 assert.ok(l.missingFields.some(field=>field.field==='publication.route.summary'));
 i.project.overview='中方案路径约10km。';
 i.route.summary='北方案路径约12km。';
 l=planLetters(i)[0];
 assert.ok(l.missingFields.some(field=>field.field==='publication.path'));
 a.allowAlternatives=true;
 assert.throws(()=>validateLettersInput(i),/仅路径调整后/);
});

test('Excel 只有确认调整轮次且填写前次意见与调整原因才允许多方案，确认随资料变更失效',()=>{
 const headers=['协议编号','部门','征询轮次','前次函件与意见','路径调整原因','允许多方案比较'];
 assert.throws(()=>agreementsFromRows([headers,['ID','测试单位','首次','','','是']]),/仅路径调整后/);
 const row=['ID','测试单位','路径调整后重新征询','前次意见要求调整走廊。','需评估新的跨越位置。','是'];
 const i=input(),old=i.agreements[0];
 i.agreements=[{...old,...agreementsFromRows([headers,row]).agreements[0],points:'请复核两处路径走廊。'}];
 i.route.summary='方案一路径长10km，方案二路径长12km。';
 const l=planLetters(i)[0],ids=['ID'];
 assert.equal(l.allowAlternatives,true);
 assert.match(l.text,/方案一路径长10km，方案二路径长12km/);
 const signature=agreementSelectionSignature(i,ids);
 i.agreements[0].changeSummary='';
 assert.notEqual(agreementSelectionSignature(i,ids),signature);
 assert.equal(planLetters(i)[0].status,'blocked');
});

test('模型校验、生成预览和人工编辑均拦截新增多方案表述',()=>{
 const t=task(),l=t.result.letters[0];
 l.retrieval={sources:[{content:'请核对线路路径范围。'},{content:'建议优先采用中方案。'}]};
 const request=JSON.parse(letterMessages(l)[1].content);
 assert.deepEqual(request.retrievedReferences,[{content:'请核对线路路径范围。'}]);
 const bodyBlocks=['{{projectOverview}}','{{routeSummary}}','建议优先采用中方案。','{{requestItems}}'];
 assert.equal(previewLetterBody(l,JSON.stringify({bodyBlocks})),'');
 assert.throws(()=>applyModel(l,{bodyBlocks}),/未经授权的方案表述/);
 assert.throws(()=>reviewLetter(t,{action:'edit',letterId:l.id,expectedRevision:1,bodyBlocks:['建议优先采用中方案。']}),/方案标识或比较/);
 assert.equal(l.revision,1);
});
