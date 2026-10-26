import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput,updateLettersInput} from './dist/letters-core.mjs';
import {createLettersTask} from './backend/letters-agent.mjs';
import {renderLetters,handleLetters,preserveLettersMenu} from './dist/letters-ui.mjs';

function fixture({stale=false,count=1,generatedIds=null,initialSelected=null,withoutTask=false}={}){
 const context=structuredClone(SAMPLE);context.project.id='UI-'+crypto.randomUUID();
 const input=createLettersInput(context,context.routes[0]);input.agreements=input.agreements.slice(0,count);input.templateConfirmed=true;
 Object.assign(input.project,{issuer:'测试单位',contactName:'测试人员',contactPhone:'测试电话',replyAddress:'测试地址'});
 const task=createLettersTask(context,{contextId:'ctx',routeIds:['A'],options:{mode:'template',lettersInput:structuredClone(input),...(generatedIds?{agreementIds:generatedIds}:{})}},{});
 const local=structuredClone(input);if(stale)local.project.issueDate='2026-10-23';
 const key='tx-letters-v2-'+context.project.id+'-'+context.project.version+'-A';
 const storage=new Map([[key,JSON.stringify({input:local,selected:initialSelected})]]),fields=new Map(),toasts=[];
 globalThis.localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
 globalThis.document={querySelector:id=>{if(!fields.has(id))fields.set(id,{value:'',checked:false,textContent:'',close(){},focus(){document.activeElement=this}});return fields.get(id)}};
 let html='',modal;
 const env={context,routeId:'A',tasks:withoutTask?[]:[task],config:{baseUrl:'http://example.test'},routeSelect:'',projectBar:'<!--project-->',toast:text=>toasts.push(text),modal:(title,body,footer)=>modal={title,body,footer},saveTask:t=>{env.tasks=[t,...env.tasks.filter(x=>x.id!==t.id)]},render:()=>{html=renderLetters(env)}};
 env.render();
 return {input,task,env,storage,key,toasts,get html(){return html},get modal(){return modal},field:id=>document.querySelector(id)};
}

test('进度重绘保留更多操作的展开、滚动和键盘焦点，主动收起后不重新打开',()=>{
 const original=globalThis.document;
 let current,updates=0;
 const makeMenu=()=>{
  const panel={scrollTop:0};
  const summary={focus:()=>{document.activeElement=summary}};
  const item={dataset:{op:'simulate'},disabled:false,focus:()=>{document.activeElement=item}};
  return {open:false,panel,summary,item,contains:el=>el===summary||el===item,querySelector:s=>s==='summary'?summary:panel,querySelectorAll:()=>[item]};
 };
 try{
  current=makeMenu();current.open=true;current.panel.scrollTop=135;
  globalThis.document={activeElement:current.summary,querySelector:()=>current};
  for(let i=0;i<3;i++){
   preserveLettersMenu(()=>{current=makeMenu();document.activeElement=null;updates++});
   assert.equal(current.open,true);assert.equal(current.panel.scrollTop,135);assert.equal(document.activeElement,current.summary);
  }
  assert.equal(updates,3);
  document.activeElement=current.item;
  preserveLettersMenu(()=>{current=makeMenu();document.activeElement=null});
  assert.equal(document.activeElement,current.item);
  current.open=false;document.activeElement=null;
  preserveLettersMenu(()=>{current=makeMenu()});assert.equal(current.open,false);
 }finally{globalThis.document=original;}
});

test('菜单重绘不会抢走外部焦点，也不会恢复已禁用操作的焦点',()=>{
 const original=globalThis.document;let current;
 const outside={};
 const makeMenu=(disabled=false)=>{
  const panel={scrollTop:0},summary={focus(){throw new Error('不应聚焦菜单标题')}},item={dataset:{op:'simulate'},disabled,focus(){throw new Error('不应聚焦菜单操作')}};
  return {open:true,item,contains:el=>el===item,querySelector:s=>s==='summary'?summary:panel,querySelectorAll:()=>[item]};
 };
 try{
  current=makeMenu();globalThis.document={activeElement:outside,querySelector:()=>current};
  preserveLettersMenu(()=>{current=makeMenu()});assert.equal(document.activeElement,outside);
  document.activeElement=current.item;
  preserveLettersMenu(()=>{current=makeMenu(true);document.activeElement=outside});assert.equal(document.activeElement,outside);
  preserveLettersMenu(()=>{current=null});assert.equal(current,null);
 }finally{globalThis.document=original;}
});

test('正常页面只突出编辑和起草，固定模板入口位于默认折叠的更多操作中',()=>{
 const f=fixture(),header=f.html.split('<!--project-->')[0];
 const main=header.replace(/<details class="letter-more">[\s\S]*?<\/details>/,'');
 assert.match(main,/data-op="input"/);assert.match(main,/data-op="run-llm"/);
 assert.doesNotMatch(main,/生成模板草稿|更新资料|data-op="sync"/);
 assert.match(header,/<details class="letter-more"><summary>更多操作/);
 assert.match(header,/<details[^>]*>[\s\S]*data-op="run-template"[\s\S]*<\/details>/);
 const menu=header.match(/<div class="letter-more-menu">([\s\S]*?)<\/div>/)[1];
 assert.equal((menu.match(/class="letter-more-item"/g)||[]).length,6);
 assert.equal((menu.match(/class="letter-more-title"/g)||[]).length,6);
 assert.equal((menu.match(/class="letter-more-description"/g)||[]).length,6);
 assert.equal((menu.match(/<hr class="letter-more-divider">/g)||[]).length,1);
 assert.match(menu,/data-op="xlsx"[\s\S]*<\/button><hr class="letter-more-divider"><button[^>]*data-op="simulate"[\s\S]*data-op="run-template"/);
 assert.doesNotMatch(menu,/<p>|征询单位建议/);
 assert.doesNotMatch(f.html,/data-op="sync"/);
});

test('勾选立即切换到对应单位，取消勾选过滤预览，清空选择及刷新不会显示其他单位',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw new Error('切换选择不得请求接口')};
  const f=fixture({count:3}),[a,b,c]=f.input.agreements;
  const preview=()=>f.html.split('letter-preview-body">')[1].split('</section>')[0];
  await handleLetters({dataset:{op:'select',id:b.id},checked:true});
  assert.match(preview(),new RegExp(b.unit+'：'));assert.match(f.html,/已选 3 项 · 已生成 3 份/);
  await handleLetters({dataset:{op:'select',id:b.id},checked:false});
  assert.ok(!preview().includes(b.unit));assert.ok(preview().includes(a.unit+'：'));
  await handleLetters({dataset:{op:'select',id:a.id},checked:false});
  assert.ok(preview().includes(c.unit+'：'));assert.ok(!preview().includes(a.unit));
  await handleLetters({dataset:{op:'select',id:c.id},checked:false});
  assert.match(preview(),/尚未勾选协议事项/);assert.doesNotMatch(preview(),/letter-paper|data-op="confirm"/);
  const reloaded=await import('./dist/letters-ui.mjs?selectreload='+crypto.randomUUID());
  assert.match(reloaded.renderLetters(f.env),/尚未勾选协议事项/);assert.deepEqual(JSON.parse(f.storage.get(f.key)).selected,[]);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('新增勾选未生成单位显示该单位待生成状态，并阻止对旧函件复核',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw new Error('未生成单位不得操作旧函件')};
  const f=fixture();
  const other={...structuredClone(f.input.agreements[0]),id:'AGR-NOT-GENERATED',unit:'尚未生成的测试单位'};
  const saved=JSON.parse(f.storage.get(f.key));saved.input.agreements.push(other);saved.selected=[f.input.agreements[0].id];f.storage.set(f.key,JSON.stringify(saved));
  // A fresh module emulates reloading an older task with a newly added agreement.
  const ui=await import('./dist/letters-ui.mjs?newagreement='+crypto.randomUUID());let html='';
  const env={...f.env,render:()=>{html=ui.renderLetters(env)}};env.render();
  await ui.handleLetters({dataset:{op:'select',id:other.id},checked:true});
  const preview=html.split('letter-preview-body">')[1].split('</section>')[0];
  assert.match(preview,/<h2>尚未生成的测试单位<\/h2>/);assert.match(preview,/尚未生成函件/);assert.doesNotMatch(preview,/letter-paper|data-op="confirm"/);
  await ui.handleLetters({dataset:{op:'confirm'}});assert.match(f.toasts.at(-1),/当前选中的单位生成函件/);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('筛选后的编辑仍操作屏幕对应函件，重新生成只提交勾选的单位',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture({count:3}),[a,b,c]=f.input.agreements,requests=[];
  await handleLetters({dataset:{op:'select',id:a.id},checked:false});await handleLetters({dataset:{op:'select',id:c.id},checked:false});
  globalThis.fetch=async(url,options)=>{
   const body=JSON.parse(options.body);requests.push({url,body});
   if(body.action==='edit'){assert.equal(body.letterId,f.task.result.letters.find(l=>l.agreementIds.includes(b.id)).id);return new Response(JSON.stringify(f.task));}
   if(url.endsWith('/context'))return new Response(JSON.stringify({contextId:'ctx'}));
   assert.deepEqual(body.options.agreementIds,[b.id]);return new Response(JSON.stringify(createLettersTask(f.env.context,body,{})),{status:201});
  };
  await handleLetters({dataset:{op:'edit'}});f.field('#letter-body').value='为当前选中单位修改正文';await f.field('#letter-save').onclick();
  await handleLetters({dataset:{op:'run-template'}});assert.equal(requests.length,3);
 }finally{globalThis.fetch=original;}
});

test('尚无任务时勾选也能显示单位，取消全部选择显示明确空状态',async()=>{
 const f=fixture({withoutTask:true});assert.match(f.html,/尚未生成函件/);
 await handleLetters({dataset:{op:'select',id:f.input.agreements[0].id},checked:false});assert.match(f.html,/尚未勾选协议事项/);
});

function fillNewAgreement(f,unit='新增测试单位'){
 for(const [id,value] of Object.entries({'la-unit':unit,'la-type':'general','la-status':'未发函','la-round':'first','la-template':'','la-authority':'','la-areas':'','la-scope':'测试区段','la-points':'征询路径意见','la-reply':'','la-history':'','la-change':''}))f.field('#'+id).value=value;
}

test('新增窗口关闭前后不写入输入或选择，只有确认后才加入清单',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture({withoutTask:true,initialSelected:[]}),before=f.storage.get(f.key);let calls=0;
  globalThis.fetch=async url=>{calls++;assert.ok(url.endsWith('/letter-resources'));return new Response(JSON.stringify({templates:[],authorities:[]}))};
  for(let n=0;n<3;n++){
   document.activeElement={blur(){document.activeElement=null}};
   await handleLetters({dataset:{op:'add'}});
   assert.equal(f.modal.title,'新增协议事项');assert.equal(document.activeElement,null);assert.match(f.modal.footer,/确认新增/);assert.doesNotMatch(f.modal.title,/AGR-/);
   fillNewAgreement(f);assert.equal(f.storage.get(f.key),before);assert.match(f.html,/协议事项 · 1/);
   f.field('#dialog').close();assert.equal(f.storage.get(f.key),before);
  }
  await handleLetters({dataset:{op:'add'}});fillNewAgreement(f,'');await f.field('#letter-save').onclick();
  assert.match(f.field('#letter-error').textContent,/请填写收函单位/);assert.equal(f.storage.get(f.key),before);
  fillNewAgreement(f);await f.field('#letter-save').onclick();
  const saved=JSON.parse(f.storage.get(f.key));assert.equal(saved.input.agreements.length,2);assert.equal(saved.input.agreements.at(-1).unit,'新增测试单位');
  assert.deepEqual(saved.selected,[saved.input.agreements.at(-1).id]);assert.match(f.html,/协议事项 · 2/);assert.equal(calls,4);
 }finally{globalThis.fetch=original;}
});

test('确认新增后仍可删除，不调用模型，清理选择和确认并保留已有任务',async()=>{
 const original=globalThis.fetch;const requests=[];
 try{
  const f=fixture(),before=JSON.stringify(f.task);
  globalThis.fetch=async(url,options)=>{requests.push(url);if(url.endsWith('/letter-resources'))return new Response(JSON.stringify({templates:[],authorities:[]}));const b=JSON.parse(options.body);assert.equal(b.action,'update-input');const t=structuredClone(f.env.tasks[0]);updateLettersInput(t,b,{});return new Response(JSON.stringify(t))};
  await handleLetters({dataset:{op:'confirm-list'}});f.field('#list-reviewer').value='测试人';f.field('#list-note').value='已核对';f.field('#list-check').checked=true;await f.field('#letter-save').onclick();
  await handleLetters({dataset:{op:'add'}});
  fillNewAgreement(f);await f.field('#letter-save').onclick();
  const added=JSON.parse(f.storage.get(f.key)).input.agreements.at(-1);
  assert.match(f.html,new RegExp('data-op="remove-agreement" data-id="'+added.id+'"'));
  assert.match(f.html,/协议事项 · 2/);
  await handleLetters({dataset:{op:'select',id:added.id},checked:true});
  await handleLetters({dataset:{op:'remove-agreement',id:added.id}});
  const saved=JSON.parse(f.storage.get(f.key));
  assert.equal(saved.input.agreements.length,1);assert.ok(!saved.selected.includes(added.id));assert.equal(saved.listConfirmation,undefined);
  assert.match(f.html,/协议事项 · 1/);assert.doesNotMatch(f.html,/单位待填写/);assert.ok(!f.html.includes('data-op="remove-agreement" data-id="'+added.id+'"'));
  assert.equal(JSON.stringify(f.task),before);assert.equal(requests.length,3);assert.equal(f.toasts.at(-1),'协议事项已删除');
 }finally{globalThis.fetch=original;}
});

test('尚无任务时可删除到零项，刷新仍为空，新增和生成校验继续有效',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  const f=fixture({withoutTask:true}),id=f.input.agreements[0].id;
  globalThis.fetch=async()=>{calls++;throw new Error('不应请求接口')};
  await handleLetters({dataset:{op:'remove-agreement',id}});
  assert.match(f.html,/协议事项 · 0/);assert.match(f.html,/尚未勾选协议事项/);assert.deepEqual(JSON.parse(f.storage.get(f.key)).input.agreements,[]);
  const ui=await import('./dist/letters-ui.mjs?emptyafterdelete='+crypto.randomUUID());assert.match(ui.renderLetters(f.env),/协议事项 · 0/);
  await handleLetters({dataset:{op:'run-template'}});assert.match(f.toasts.at(-1),/协议清单需包含/);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('模型运行中的事项不会被删除',async()=>{
 const f=fixture(),id=f.input.agreements[0].id,before=f.storage.get(f.key);
 f.task.status='running';await handleLetters({dataset:{op:'remove-agreement',id}});assert.match(f.toasts.at(-1),/任务正在处理/);assert.equal(f.storage.get(f.key),before);
});

test('示例单位及已有函件事项均有删除入口，删除同步后预览和任务不再包含该单位',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture({count:3}),id=f.input.agreements[1].id,unit=f.input.agreements[1].unit,originalLetter=structuredClone(f.task.result.letters[1]);
  assert.equal((f.html.match(/data-op="remove-agreement"/g)||[]).length,3);
  globalThis.fetch=async(url,options)=>{const b=JSON.parse(options.body);assert.ok(url.endsWith('/tasks/'+f.task.id));assert.equal(b.action,'update-input');const t=structuredClone(f.env.tasks[0]);updateLettersInput(t,b,{});return new Response(JSON.stringify(t))};
  await handleLetters({dataset:{op:'tab',index:'1'}});
  await handleLetters({dataset:{op:'remove-agreement',id}});
  assert.match(f.html,/协议事项 · 2/);assert.ok(!f.html.includes(unit));assert.doesNotMatch(f.html,/资料同步失败|data-op="sync"/);
  assert.equal(f.env.tasks[0].result.letters.length,2);assert.deepEqual(f.env.tasks[0].removedLetters[0].letter,originalLetter);
  for(const a of [...JSON.parse(f.storage.get(f.key)).input.agreements])await handleLetters({dataset:{op:'remove-agreement',id:a.id}});
  assert.match(f.html,/协议事项 · 0/);assert.match(f.html,/尚未勾选协议事项/);assert.equal(f.env.tasks[0].result.letters.length,0);
  assert.equal(f.env.tasks[0].removedLetters.length,3);assert.notEqual(f.env.tasks[0].status,'confirmed');
 }finally{globalThis.fetch=original;}
});

test('已同步但尚未生成的事项删除后更新后端输入，保留其他正文且不重新起草',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture({count:2,generatedIds:[SAMPLE.agreements[0].id]}),removed=f.input.agreements[1].id;
  const body=structuredClone(f.task.result.letters[0].bodyBlocks),requests=[];
  globalThis.fetch=async(url,options)=>{
   const b=JSON.parse(options.body);requests.push(b.action);assert.ok(url.endsWith('/tasks/'+f.task.id));assert.equal(b.action,'update-input');
   assert.ok(!b.lettersInput.agreements.some(a=>a.id===removed));
   const updated=structuredClone(f.task);updateLettersInput(updated,b,{});return new Response(JSON.stringify(updated));
  };
  await handleLetters({dataset:{op:'remove-agreement',id:removed}});
  assert.deepEqual(requests,['update-input']);assert.equal(f.env.tasks[0].input.agreements.length,1);
  assert.deepEqual(f.env.tasks[0].result.letters[0].bodyBlocks,body);assert.doesNotMatch(f.html,/资料同步失败|data-op="sync"/);
 }finally{globalThis.fetch=original;}
});

test('正式模型起草先确认单位与事项清单，确认和预览不调用模型，勾选变化后需重确认',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  const f=fixture({count:2});globalThis.fetch=async()=>{calls++;throw new Error('确认前不得请求模型或新建任务')};
  await handleLetters({dataset:{op:'run-llm'}});assert.match(f.modal.title,/确认征询单位/);assert.equal(calls,0);
  await handleLetters({dataset:{op:'confirm-list'}});f.field('#list-reviewer').value='清单审校人';f.field('#list-note').value='已按协议清单核对单位、属地和事项';f.field('#list-check').checked=true;await f.field('#letter-save').onclick();
  assert.equal(JSON.parse(f.storage.get(f.key)).listConfirmation.reviewer,'清单审校人');assert.equal(calls,0);
  await handleLetters({dataset:{op:'select',id:f.input.agreements[1].id},checked:false});
  await handleLetters({dataset:{op:'run-llm'}});assert.match(f.modal.title,/确认征询单位/);assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('管理窗口及协议编辑加载失败会显示错误并保留当前输入',async()=>{
 const original=globalThis.fetch;
 try{const f=fixture(),before=f.storage.get(f.key);globalThis.fetch=async()=>{throw new Error('测试后端暂不可用')};
  for(const op of ['manage-templates','manage-directory','recommend-recipients','agreement'])await handleLetters({dataset:{op,index:'0'}});
  assert.equal(f.toasts.length,4);assert.ok(f.toasts.every(t=>t==='测试后端暂不可用'));assert.equal(f.storage.get(f.key),before);
 }finally{globalThis.fetch=original;}
});

test('旧任务与本地输入不一致时只在资料提示内提供同步入口',()=>{
 const f=fixture({stale:true});
 assert.match(f.html,/当前函件有资料待同步/);assert.match(f.html,/data-op="sync"[^>]*>同步资料/);
 assert.doesNotMatch(f.html.split('<!--project-->')[0],/data-op="sync"/);
});

test('保存失败保留输入并显示可恢复的重试提示，重试刷新版本且不新建函件',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture(),requests=[],originalBody=structuredClone(f.task.result.letters[0].bodyBlocks);
  let fail=true,serverTask=structuredClone(f.task);
  globalThis.fetch=async(url,options)=>{
   const b=JSON.parse(options.body);requests.push({url,action:b.action});
   assert.ok(url.endsWith('/api/v1/tasks/'+serverTask.id),'资料保存不得新建生成任务');
   if(b.action==='status')return new Response(JSON.stringify(serverTask));
   assert.equal(b.action,'update-input');
   if(fail)return new Response(JSON.stringify({error:{message:'模拟同步失败，请重试'}}),{status:400});
   updateLettersInput(serverTask,b,{});return new Response(JSON.stringify(serverTask));
  };
  await handleLetters({dataset:{op:'input'}});
  for(const [id,key] of [['li-issuer','issuer'],['li-contact','contactName'],['li-phone','contactPhone'],['li-address','replyAddress'],['li-overview','overview']])f.field('#'+id).value=f.input.project[key];
  f.field('#li-date').value='2026-10-23';f.field('#li-number').value='';f.field('#li-route').value=f.input.route.summary;f.field('#li-template').checked=true;
  await f.field('#letter-save').onclick();
  assert.match(f.html,/资料同步失败/);assert.match(f.html,/模拟同步失败/);assert.match(f.html,/data-op="sync"[^>]*>重试更新/);
  assert.equal(JSON.parse(f.storage.get(f.key)).input.project.issueDate,'2026-10-23');
  const reloaded=await import('./dist/letters-ui.mjs?reload='+crypto.randomUUID());
  assert.match(reloaded.renderLetters(f.env),/资料同步失败/);
  fail=false;serverTask.revision++;
  await handleLetters({dataset:{op:'sync'}});
  assert.deepEqual(requests.map(x=>x.action),['update-input','status','update-input']);
  assert.equal(f.env.tasks[0].input.project.issueDate,'2026-10-23');
  assert.deepEqual(f.env.tasks[0].result.letters[0].bodyBlocks,originalBody);
  assert.doesNotMatch(f.html,/data-op="sync"|资料同步失败/);
  assert.equal(JSON.parse(f.storage.get(f.key)).syncError,undefined);
 }finally{globalThis.fetch=original;}
});

test('更多操作中的模板预览仍使用固定模板，不发送模型请求',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture(),requests=[];
  globalThis.fetch=async(url,options)=>{
   const b=JSON.parse(options.body);requests.push(url);
   if(url.endsWith('/api/v1/context'))return new Response(JSON.stringify({contextId:'ctx'}));
   assert.ok(url.endsWith('/api/v1/tasks'));assert.equal(b.options.mode,'template');
   return new Response(JSON.stringify(createLettersTask(f.env.context,b,{})),{status:201});
  };
  await handleLetters({dataset:{op:'run-template'}});
  assert.equal(requests.length,2);assert.equal(f.env.tasks[0].mode,'template');
  assert.ok(f.env.tasks[0].result.letters[0].bodyBlocks.length>0);
  assert.doesNotMatch(f.html,/data-op="sync"/);
 }finally{globalThis.fetch=original;}
});

test('模拟入口提交独立副本，展示模拟结果并能返回原任务，刷新仍保留模拟选择',async()=>{
 const original=globalThis.fetch;
 try{
  const f=fixture(),source=structuredClone(f.input),requests=[];
  assert.match(f.html,/<details[^>]*>[\s\S]*data-op="simulate"[^>]*>[\s\S]*?运行模拟流程/);
  globalThis.fetch=async(url,options)=>{
   const b=JSON.parse(options.body);requests.push(b);
   if(url.endsWith('/api/v1/context'))return new Response(JSON.stringify({contextId:'ctx'}));
   assert.equal(b.options.simulation,true);assert.equal(b.options.mode,'llm');assert.deepEqual(b.options.lettersInput,source);
   const t=structuredClone(f.task);t.id='SIM-UI';t.simulation={stage:'已完成',agreementIds:[source.agreements[0].id],filledFields:[{label:'发函单位',value:'模拟单位'}],export:{url:'/test.zip'}};t.status='simulation_completed';t.input.project.issuer='模拟单位';t.result.letters[0].status='simulated';t.result.letters[0].missingFields=[];
   return new Response(JSON.stringify(t),{status:201});
  };
  await handleLetters({dataset:{op:'simulate'}});
  assert.equal(requests.length,2);assert.match(f.html,/模拟测试 · 已完成/);assert.match(f.html,/已模拟确认/);assert.match(f.html,/data-op="real-view"/);
  assert.doesNotMatch(f.html,/data-op="sync"/);assert.deepEqual(JSON.parse(f.storage.get(f.key)).input,source);assert.equal(f.env.tasks.find(t=>t.id===f.task.id).input.project.issuer,source.project.issuer);
  const reloaded=await import('./dist/letters-ui.mjs?simreload='+crypto.randomUUID());assert.match(reloaded.renderLetters(f.env),/模拟测试 · 已完成/);
  await handleLetters({dataset:{op:'real-view'}});assert.doesNotMatch(f.html,/模拟测试 · 已完成/);assert.match(f.html,/编辑输入资料/);assert.equal(JSON.parse(f.storage.get(f.key)).simulationView,undefined);
 }finally{globalThis.fetch=original;}
});

test('模拟结果也可申请Excel台账，单位推荐入口在模拟视图中禁用',async()=>{
 const original=globalThis.fetch;
 try{const f=fixture(),sim=structuredClone(f.task);sim.id='SIM-LEDGER';sim.simulation={stage:'已完成',agreementIds:f.input.agreements.map(a=>a.id)};sim.status='simulation_completed';sim.result.letters[0].status='simulated';
  const saved=JSON.parse(f.storage.get(f.key));saved.simulationView=sim.id;f.storage.set(f.key,JSON.stringify(saved));f.env.tasks.unshift(sim);
  const ui=await import('./dist/letters-ui.mjs?simledger='+crypto.randomUUID());const html=ui.renderLetters(f.env);assert.match(html,/data-op="recommend-recipients" disabled/);
  let requested=false;globalThis.fetch=async(url,options)=>{const b=JSON.parse(options.body);assert.equal(b.action,'export');assert.equal(b.format,'xlsx');requested=true;return new Response(JSON.stringify({error:{message:'测试台账请求已到达'}}),{status:400})};
  await ui.handleLetters({dataset:{op:'xlsx'}});assert.equal(requested,true);assert.equal(f.toasts.at(-1),'测试台账请求已到达');
 }finally{globalThis.fetch=original;}
});

test('重置仅在确认后恢复初始样例，备份旧输入并保留配置与历史任务，刷新不回显旧正文',async()=>{
 const original=globalThis.fetch;let calls=0;
 try{
  globalThis.fetch=async()=>{calls++;throw new Error('重置不得调用接口或大模型')};
  const f=fixture({stale:true}),before=f.storage.get(f.key),task=structuredClone(f.task),config=structuredClone(f.env.config);
  assert.match(f.html,/data-op="reset-input"[^>]*>重置/);
  await handleLetters({dataset:{op:'reset-input'}});
  assert.equal(f.modal.title,'重置当前路径资料');assert.equal(f.storage.get(f.key),before);
  await f.field('#letter-save').onclick();
  const saved=JSON.parse(f.storage.get(f.key));
  assert.deepEqual(saved.input,createLettersInput(f.env.context,f.env.context.routes[0]));
  assert.deepEqual(JSON.parse(f.storage.get(saved.backupKey)).state,JSON.parse(before));
  assert.deepEqual(f.env.tasks,[task]);assert.deepEqual(f.env.config,config);
  assert.match(f.html,/已生成 0 份/);assert.match(f.html,/尚未生成函件/);assert.doesNotMatch(f.html,/class="letter-paper|当前函件有资料待同步/);
  const reloaded=await import('./dist/letters-ui.mjs?reset='+crypto.randomUUID());
  assert.doesNotMatch(reloaded.renderLetters(f.env),/class="letter-paper/);
  const next=structuredClone(task);next.id='AFTER-RESET-'+crypto.randomUUID();f.env.tasks.unshift(next);
  assert.match(reloaded.renderLetters(f.env),/class="letter-paper/);
  assert.equal(calls,0);
 }finally{globalThis.fetch=original;}
});

test('旧输入备份失败时阻止重置并保留原输入',async()=>{
 const f=fixture({stale:true}),before=f.storage.get(f.key);
 globalThis.localStorage.setItem=(key,value)=>{if(key.startsWith('tx-letters-reset-backup-'))throw new Error('浏览器空间不足，备份失败');f.storage.set(key,value)};
 await handleLetters({dataset:{op:'reset-input'}});
 await f.field('#letter-save').onclick();
 assert.equal(f.storage.get(f.key),before);assert.match(f.field('#letter-error').textContent,/备份失败/);
 assert.equal(f.field('#letter-save').disabled,false);
});
