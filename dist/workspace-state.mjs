import {createLettersInput} from './letters-core.mjs';

export function emptyWorkspace(){
 return {contextType:'empty',project:{id:'',name:'',version:'',voltage:'',stage:'',dataDate:'',overview:'',isDemo:false},routes:[],agreements:[],issues:[],rules:[]};
}

export function emptyLettersInput(){
 return {schemaVersion:'letters-v2',project:{...emptyWorkspace().project,issuer:'',issueDate:'',documentNumber:'',contactName:'',contactPhone:'',replyAddress:''},route:{id:'',version:'',summary:''},agreements:[],templateConfirmed:false};
}

export function currentProjectInput(context,routeId,storage){
 if(!context.project.id)return emptyLettersInput();
 const route=context.routes.find(item=>item.id===routeId);
 try{
  const saved=JSON.parse(storage.getItem('tx-letters-v2-'+context.project.id+'-'+context.project.version+'-'+routeId))?.input;
  if(saved?.schemaVersion==='letters-v2'&&saved.project?.id===context.project.id&&saved.project.version===context.project.version&&saved.route?.id===routeId)return structuredClone(saved);
 }catch{}
 return createLettersInput(context,route);
}

export function initialWorkspace(stored,storage){
 const context=stored?.context;
 if(!context?.project?.id||stored.projectImported===false)return emptyWorkspace();
 // Earlier versions automatically populated the demo without an import action.
 if(stored.projectImported!==true&&context.project.id==='PRJ-2026-018'&&context.project.isDemo)return emptyWorkspace();
 const reset=context.routes?.length&&context.routes.every(route=>{
  try{
   const state=JSON.parse(storage.getItem('tx-letters-v2-'+context.project.id+'-'+context.project.version+'-'+route.id));
   return state?.resetAt&&(!state.resetScope||state.resetScope==='project')&&state.input?.agreements?.length===0&&
    ['overview','issuer','issueDate','documentNumber','contactName','contactPhone','replyAddress'].every(field=>!state.input.project?.[field])&&!state.input.route?.summary;
  }catch{return false}
 });
 return reset?emptyWorkspace():context;
}
