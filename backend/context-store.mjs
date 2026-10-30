import {isDeepStrictEqual} from 'node:util';

// Each context ID remains immutable. Letter workspaces can register edited
// inputs under the same business version without replacing earlier contexts.
export function registerContext(contexts,context){
 const versions=Object.values(contexts).filter(entry=>entry.context.project.id===context.project.id&&entry.context.project.version===context.project.version);
 const existing=versions.find(entry=>isDeepStrictEqual(entry.context,context));
 if(existing)return {entry:existing,created:false};
 if(versions.length&&context.contextType!=='letters')throw new Error('同一工程快照不可覆盖，请更新 project.version');
 const revision=1+Math.max(0,...versions.map(entry=>entry.revision||1));
 const id='CTX-'+crypto.randomUUID(),entry={id,revision,createdAt:new Date().toISOString(),context:structuredClone(context)};
 contexts[id]=entry;
 return {entry,created:true};
}
