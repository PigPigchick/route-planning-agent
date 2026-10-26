import {test} from 'node:test';
import assert from 'node:assert/strict';
import {SAMPLE} from './dist/engine.mjs';
import {createLettersInput,reviewLetter,updateLettersInput} from './dist/letters-core.mjs';
import {simulationFields,applySimulationValues,runSimulation} from './backend/letters-simulation.mjs';
import {createLettersTask} from './backend/letters-agent.mjs';

test('模拟补全只写缺失白名单，保留原输入且禁止日期和数值错误',()=>{
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]),original=structuredClone(input),ids=input.agreements.map(a=>a.id),fields=simulationFields(input,ids);
 const output={values:Object.fromEntries(fields.map(f=>[f.key,f.type==='number'?12:f.field==='project.issueDate'?'2026-10-23':'模拟测试值'])),attachmentNotes:Object.fromEntries(ids.map(id=>[id,'模拟附件内容']))};
 output.values['project.id']='恶意覆盖';output.values['templateConfirmed']=true;
 const filled=applySimulationValues(input,ids,fields,output);
 assert.deepEqual(input,original);assert.equal(filled.project.id,original.project.id);assert.equal(filled.templateConfirmed,true);
 output.values['project.issueDate']='2026-02-30';assert.throws(()=>applySimulationValues(input,ids,fields,output),/日期无效/);
 output.values['project.issueDate']='2026-10-23';delete output.values[fields[0].key];assert.throws(()=>applySimulationValues(input,ids,fields,output),/模拟补全缺失/);
});

test('模拟记录不能作为人工复核或覆盖真实任务，模型错误不会自动确认或导出',async()=>{
 const input=createLettersInput(SAMPLE,SAMPLE.routes[0]);
 const task=createLettersTask(SAMPLE,{routeIds:['A'],options:{mode:'llm',lettersInput:input}},{});
 task.simulation={agreementIds:task.result.letters.flatMap(l=>l.agreementIds),stage:'准备中',confirmations:[]};
 assert.throws(()=>reviewLetter(task,{}),/模拟确认/);assert.throws(()=>updateLettersInput(task,{}),/模拟记录/);
 let exported=false;
 await runSimulation(task,{model:'',apiKey:''},{save:async()=>{},createAssets:async()=>{throw new Error('不得创建附件')},exportZip:async()=>{exported=true}});
 assert.equal(task.status,'failed');assert.match(task.error,/模型名称/);assert.equal(exported,false);assert.deepEqual(task.simulation.confirmations,[]);
});
