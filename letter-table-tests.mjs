import test from 'node:test';
import assert from 'node:assert/strict';
import {parseTableText,agreementsFromRows,workbookToLetters,workbookProjects,letterContext,TABLE_FIELDS} from './dist/letter-table.mjs';
import {SAMPLE,validateContext,makeTask} from './dist/engine.mjs';
import {createLettersInput,planLetters} from './dist/letters-core.mjs';
import {readLetterWorkbook} from './backend/letter-xlsx.mjs';
import {readFile} from 'node:fs/promises';
import {openLetterTableImport} from './dist/letter-table-ui.mjs';
import {replaceEngineeringLetters} from './dist/engineering-import.mjs';
const current=()=>createLettersInput(SAMPLE,SAMPLE.routes[0]);
test('表格解析支持Excel换行及引号，旧两列不编造区段事项或正式单位',()=>{
 assert.deepEqual(parseTableText('行政区域\t部门\t征询事项\n模拟区\t测试局\t"第一行\n第二行"'),[['行政区域','部门','征询事项'],['模拟区','测试局','第一行\n第二行']]);
 assert.throws(()=>parseTableText('部门\n"没闭合'),/未闭合/);
 const p=agreementsFromRows([['行政区域','部门'],['模拟区','铁路']]);assert.equal(p.agreements[0].points,'');assert.equal(p.agreements[0].unit,'铁路');assert.equal(p.warnings.length,2);
});
test('编号重复、空单位、无效类型轮次及超过500行均明确拦截',()=>{
 assert.throws(()=>agreementsFromRows([['部门'],['']]),/1至500/);
 assert.throws(()=>agreementsFromRows([['编号','部门'],['A','甲'],['A','乙']]),/编号重复/);
 assert.throws(()=>agreementsFromRows([['部门','类型'],['甲','猜测类型']]),/类型无效/);
 assert.throws(()=>agreementsFromRows([['部门','征询轮次'],['甲','第四轮']]),/轮次无效/);
 assert.equal(agreementsFromRows([['部门'],...Array.from({length:500},(_,i)=>['甲'+i])]).agreements.length,500);
 assert.throws(()=>agreementsFromRows([['部门'],...Array.from({length:501},()=>['甲'])]),/1至500/);
});
test('整表编辑按编号保留附件、专项数据与回函摘要；换类型清除旧专项参数',()=>{
 const old={...current().agreements[0],replySummary:'历史回复',facts:{roadName:'道路甲'},crossings:[{id:'1'}],templateId:'专用模板'};
 const rows=[TABLE_FIELDS.map(x=>x[1]),TABLE_FIELDS.map(([k])=>old[k]||'')];
 const next=agreementsFromRows(rows,[old]).agreements[0];assert.deepEqual(next.attachments,old.attachments);assert.deepEqual(next.facts,old.facts);assert.equal(next.replySummary,'历史回复');
 rows[1][3]='water';const changed=agreementsFromRows(rows,[old]).agreements[0];assert.deepEqual(changed.facts,{});assert.equal(changed.crossings,undefined);
});
test('工作簿预览是独立副本，未确认不改变旧输入，不自动确认模板或造工程指标',()=>{
 const input=current(),before=structuredClone(input);
 const p=workbookToLetters({sheets:[{name:'协议清单',rows:[['行政区域','部门'],['区甲','单位甲']]}]},input);
 assert.deepEqual(input,before);assert.equal(p.input.templateConfirmed,false);assert.equal(p.newProject,false);
 const c=letterContext(p.input);validateContext(c);assert.equal(c.routes[0].lengthKm,undefined);assert.throws(()=>makeTask(c,'comparison',[c.routes[0].id]),/路径|空间/);
});
test('实际XLSX模板能解析，再按字段映射工程、三项协议与测试TXT，正式资料禁止内嵌模拟附件',async()=>{
 const name='征询函输入模板.xlsx';
 const b=await readFile('dist/assets/'+name);
 const wb=await readLetterWorkbook(process.cwd(),{name,base64:b.toString('base64')});
 const values={'工程编号':'XLSX-TEST-20261028','工程名称':'测试工程','工程版本':'test-v1','路径编号':'A','工程概况':'测试工程概况','路径描述':'测试路径','是否测试样例':'是','联系电话':'测试联系电话','发函日期':'2026-10-28'};
 wb.sheets.find(s=>s.name==='工程信息').rows.slice(1).forEach(r=>r[1]=values[r[0]]||'');
 wb.sheets.find(s=>s.name==='协议清单').rows.push(...['甲','乙','丙'].map((u,i)=>['XL-'+i,'测试区','测试单位'+u,'general','测试事项','first','未发函']));
 wb.sheets.find(s=>s.name==='附件清单').rows.push(...[0,1,2].map(i=>['XL-'+i,'路径图','仅测试'+i+'.txt','仅测试的文字']));
 const p=workbookToLetters(wb,current());
 assert.equal(p.input.project.id,'XLSX-TEST-20261028');assert.equal(p.input.agreements.length,3);assert.equal(p.pendingAssets.length,3);assert.equal(p.input.project.contactPhone,'测试联系电话');assert.equal(p.input.project.issueDate,'2026-10-28');assert.equal(p.newProject,true);
 assert.equal(p.input.agreements[0].unit,'测试单位甲');assert.equal(p.input.templateConfirmed,false);
 const info=wb.sheets.find(s=>s.name==='工程信息');info.rows.find(r=>r[0]==='是否测试样例')[1]='否';assert.throws(()=>workbookToLetters(wb,current()),/仅限/);
});
test('一次起草超过30项有明确上限；工程信息缺项不悄悄沿用旧值',()=>{
 const input=current();input.agreements=Array.from({length:31},(_,i)=>({...input.agreements[0],id:'A'+i}));
 assert.throws(()=>planLetters(input),/30/);
 assert.throws(()=>workbookToLetters({sheets:[{name:'协议清单',rows:[['部门'],['甲']]},{name:'工程信息',rows:[['字段','填写内容'],['工程名称','新工程']]}]},current()),/工程编号/);
});
test('多工程工作簿先选工程，分别载入清单、默认选择和对应附件，不串用另一个工程',()=>{
 const sheets=[];
 for(const code of ['P01','P02','P03','P04']){
  sheets.push({name:code+'_工程信息',rows:[['字段','填写内容'],['工程编号','ENGINE-'+code],['工程名称','测试工程'+code],['工程版本','v1'],['路径编号',code],['是否测试样例','是'],['本次起草协议编号',code+'-2']]});
  sheets.push({name:code+'_协议清单',rows:[['协议编号','部门'],[code+'-1',code+'单位甲'],[code+'-2',code+'单位乙']]});
 }
 sheets.push({name:'附件清单',rows:[['工程编号','协议编号','附件类型','文件名','测试附件内容'],...['P01','P02','P03','P04'].map(code=>[code,code+'-2','路径图',code+'.txt','仅测试'])]});
 const wb={sheets};assert.equal(workbookProjects(wb).length,4);assert.throws(()=>workbookToLetters(wb,current()),/请先选择/);assert.throws(()=>workbookToLetters(wb,current(),'P09'),/不在工作簿/);
 for(const code of ['P01','P02','P03','P04']){const p=workbookToLetters(wb,current(),code);assert.equal(p.input.project.id,'ENGINE-'+code);assert.ok(p.input.agreements.every(a=>a.id.startsWith(code)));assert.deepEqual(p.selectedIds,[code+'-2']);assert.equal(p.pendingAssets.length,1);assert.equal(p.pendingAssets[0].name,code+'.txt');}
 sheets.find(s=>s.name==='P04_工程信息').rows.find(r=>r[0]==='本次起草协议编号')[1]='P01-2';assert.throws(()=>workbookToLetters(wb,current(),'P04'),/起草协议编号/);
});
test('Excel预览不自动勾选文件推荐的林业局，用户选交通单位后只提交该项，重导又清空选择',async()=>{
 const original=globalThis.document,fields=new Map();
 const field=id=>{if(!fields.has(id))fields.set(id,{value:'',files:[],disabled:false,isConnected:true,textContent:'',closest:()=>({open:true}),close(){}});return fields.get(id);};
 const input=current(),a=input.agreements[0],b=input.agreements[1];let modal,applied;
 const wb={sheets:[{name:'工程信息',rows:[['字段','填写内容'],['工程编号',input.project.id],['工程名称',input.project.name],['工程版本',input.project.version],['路径编号',input.route.id],['本次起草协议编号',a.id]]},{name:'协议清单',rows:[['协议编号','部门'],[a.id,'韶关市林业局'],[b.id,'本次交通单位']]}]};
 const env={modal:(title,body)=>modal={title,body},render(){}};
 const parse=async()=>{openLetterTableImport(env,input,async()=>wb,async p=>{applied=structuredClone(p)});field('#letter-xlsx-file').files=[{name:'样例.xlsx',size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer}];await field('#letter-parse-table').onclick();};
 try{
  globalThis.document={querySelector:field};await parse();assert.match(modal.body,/本次已勾选 0 项/);assert.doesNotMatch(modal.body,/推荐测试项/);assert.doesNotMatch(modal.body,/type="checkbox"[^>]*\schecked/);
  await field('#letter-table-confirm').onclick();assert.deepEqual(applied.selectedIds,[]);
  await parse();field('#dialog').onchange({target:{dataset:{importAgreement:b.id},checked:true,closest:()=>({classList:{toggle(){}}})}});await field('#letter-table-confirm').onclick();assert.deepEqual(applied.selectedIds,[b.id]);
  await parse();await field('#letter-table-confirm').onclick();assert.deepEqual(applied.selectedIds,[]);
 }finally{globalThis.document=original;}
});
test('工程JSON重导替换旧工作副本，备份原资料且清空选择，不从历史任务回填旧单位',()=>{
 const c=structuredClone(SAMPLE),data=new Map(),storage={getItem:k=>data.get(k)??null,setItem:(k,v)=>data.set(k,v),removeItem:k=>data.delete(k)};
 const key='tx-letters-v2-'+c.project.id+'-'+c.project.version+'-'+c.routes[0].id;
 const old=JSON.stringify({input:{agreements:[{unit:'韶关市林业局'}]},selected:['OLD']});data.set(key,old);
 c.agreements=[{id:'NEW',unit:'本次交通单位',type:'general',points:'征询事项',attachments:[]}];
 const task={id:'OLD-TASK',schemaVersion:'letters-v2',projectId:c.project.id,projectVersion:c.project.version,routeIds:[c.routes[0].id]};const backup=replaceEngineeringLetters(c,[task],storage),next=JSON.parse(data.get(key));
 assert.deepEqual(next.selected,[]);assert.equal(next.input.agreements[0].unit,'本次交通单位');assert.deepEqual(next.historyTaskIds,['OLD-TASK']);assert.equal(JSON.parse(data.get(backup)).entries[0].previous,old);
});
test('拖拽Excel与选文件共用解析入口，文件类型、大小和多文件错误明确提示且不沿用旧文件',async()=>{
 const original=globalThis.document,fields=new Map(),classes=new Set();let calls=0,last;
 const field=id=>{if(!fields.has(id))fields.set(id,{value:'',files:[],hidden:true,isConnected:true,textContent:'',closest:()=>({open:true}),classList:{add:x=>classes.add(x),remove:x=>classes.delete(x)}});return fields.get(id);};
 const evt=files=>({preventDefault(){},stopPropagation(){},dataTransfer:{files}});
 const valid={name:'拖拽样例.xlsx',size:1,arrayBuffer:async()=>new Uint8Array([1]).buffer};
 try{
  globalThis.document={querySelector:field};openLetterTableImport({modal(){},render(){}},current(),async(p,b)=>{calls++;last=b;return {sheets:[{name:'协议清单',rows:[['部门'],['测试收函单位']]}]}},()=>{});
  const upload=field('#letter-xlsx-drop');upload.ondragenter(evt([]));assert.ok(classes.has('is-dragging'));
  upload.ondrop(evt([{...valid,name:'不支持.pdf'}]));assert.match(field('#letter-table-error').textContent,/xlsx/);assert.ok(!classes.has('is-dragging'));
  upload.ondrop(evt([{...valid,size:6*1024*1024+1}]));assert.match(field('#letter-table-error').textContent,/6MB/);
  upload.ondrop(evt([valid]));assert.equal(field('#letter-xlsx-selected').hidden,false);assert.match(field('#letter-xlsx-selected').textContent,/拖拽样例.xlsx/);await field('#letter-parse-table').onclick();assert.equal(calls,1);assert.equal(last.name,valid.name);
  // A failed replacement cannot accidentally parse the previous valid upload.
  openLetterTableImport({modal(){},render(){}},current(),async()=>{calls++},()=>{});field('#letter-xlsx-drop').ondrop(evt([valid]));field('#letter-xlsx-drop').ondrop(evt([valid,valid]));await field('#letter-parse-table').onclick();assert.equal(calls,1);assert.match(field('#letter-table-error').textContent,/选择Excel文件/);
 }finally{globalThis.document=original;}
});
