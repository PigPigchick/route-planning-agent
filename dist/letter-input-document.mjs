import {validateContext} from './engine.mjs';
import {createLettersInput,validateLettersInput} from './letters-core.mjs';

// Both existing project documents and letter working copies are valid inputs.
export function readLettersDocument(document,{routeId}={}){
 if(!document||typeof document!=='object'||Array.isArray(document))throw new Error('请选择完整的工程或函件 JSON 对象');
 const missing=[['id','工程编号'],['name','工程名称'],['version','工程版本']].filter(([key])=>!document.project?.[key]).map(([,label])=>label);
 if(missing.length)throw new Error('输入缺少：'+missing.join('、')+'，请使用完整工程输入文件');
 if(document.schemaVersion==='letters-v2'){
  const input=structuredClone(document);validateLettersInput(input,{allowEmpty:true});return input;
 }
 validateContext(document);
 const route=document.routes.find(item=>item.id===routeId)||(document.routes.length===1?document.routes[0]:null);
 if(!route)throw new Error('工程有多条路径，请先选择本次路径');
 const input=createLettersInput(document,route);
 for(const field of ['issuer','issueDate','documentNumber','contactName','contactPhone','replyAddress']){
  if(document.project[field]!==undefined)input.project[field]=document.project[field];
 }
 input.templateConfirmed=document.templateConfirmed===true;
 validateLettersInput(input,{allowEmpty:true});return input;
}
