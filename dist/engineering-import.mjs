import {createLettersInput} from './letters-core.mjs';

// A newly supplied engineering file replaces its working copy; history stays in tasks.
export function replaceEngineeringLetters(context,tasks,storage){
 const entries=context.routes.map(route=>{
  const key='tx-letters-v2-'+context.project.id+'-'+context.project.version+'-'+route.id;
  return {key,previous:storage.getItem(key),state:{input:createLettersInput(context,route),selected:[],importToken:crypto.randomUUID(),historyTaskIds:tasks.filter(t=>t.schemaVersion==='letters-v2'&&t.projectId===context.project.id&&t.projectVersion===context.project.version&&t.routeIds.includes(route.id)).map(t=>t.id)}};
 });
 const backup='tx-engineering-letters-backup-'+crypto.randomUUID();
 storage.setItem(backup,JSON.stringify({at:new Date().toISOString(),entries:entries.map(({key,previous})=>({key,previous}))}));
 try{for(const e of entries)storage.setItem(e.key,JSON.stringify(e.state));}
 catch(error){for(const e of entries){try{e.previous===null?storage.removeItem(e.key):storage.setItem(e.key,e.previous);}catch{}}throw error;}
 return backup;
}
