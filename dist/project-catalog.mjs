import {emptyLettersInput} from './workspace-state.mjs';

export const projectKey = context => JSON.stringify([context?.project?.id||'',context?.project?.version||'']);
const valid = context => !!(context?.project?.id&&context.project.name&&context.project.version&&Array.isArray(context.routes)&&context.routes.length&&context.routes.every(r=>r.id&&r.name));
export function rememberProject(entries,context,routeId,selected=[]){
 if(!valid(context))return entries;
 const key=projectKey(context),route=context.routes.some(r=>r.id===routeId)?routeId:context.routes[0].id;
 const entry={key,context:structuredClone(context),routeId:route,selected:(Array.isArray(selected)?selected:[]).filter(id=>context.routes.some(r=>r.id===id))};
 const index=entries.findIndex(e=>e.key===key);
 return index<0?[...entries,entry]:entries.map((e,i)=>i===index?entry:e);
}
export function initialProjectCatalog(stored,context){
 const entries=[];
 for(const entry of Array.isArray(stored?.projects)?stored.projects:[]){
  if(!valid(entry?.context))continue;
  const normalized=rememberProject([],entry.context,entry.routeId,entry.selected||[])[0];
  if(!entries.some(e=>e.key===normalized.key))entries.push(normalized);
 }
 // The explicitly reset/empty current workspace must stay empty on reload.
 return rememberProject(entries,context,stored?.routeId,stored?.selected||context.routes.map(r=>r.id));
}
export function projectLabel(entry,entries){
 const p=entry.context.project,duplicates=entries.filter(e=>e.context.project.name===p.name);
 return p.name+(duplicates.length>1?' · '+p.id+' · '+p.version:'');
}
export function newProjectInput(fields){
 const input=emptyLettersInput(),trim=key=>String(fields[key]??'').trim();
 Object.assign(input.project,Object.fromEntries(['id','name','version','voltage','stage','overview','issuer','issueDate','documentNumber','contactName','contactPhone','replyAddress'].map(key=>[key,trim(key)])));
 input.route={id:trim('routeId'),version:input.project.version,summary:trim('routeSummary')};
 for(const [key,label] of [['name','工程名称'],['id','工程编号'],['version','数据快照'],['routeId','路径编号']])if(!trim(key))throw new Error('请填写'+label);
 return input;
}

export function archiveProject(entries,deleted,key,at=new Date().toISOString()){
 const entry=entries.find(item=>item.key===key);
 if(!entry)throw new Error('工程不存在，请刷新后重试');
 return {projects:entries.filter(item=>item.key!==key),deletedProjects:[...deleted.filter(item=>item.key!==key),{...structuredClone(entry),deletedAt:at}]};
}
export function restoreProject(entries,deleted,key){
 const entry=deleted.find(item=>item.key===key);
 if(!entry)throw new Error('待恢复工程不存在');
 if(entries.some(item=>item.key===key))throw new Error('工程列表中已存在相同编号和快照的工程');
 const {deletedAt,...restored}=structuredClone(entry);
 return {projects:[...entries,restored],deletedProjects:deleted.filter(item=>item.key!==key)};
}
