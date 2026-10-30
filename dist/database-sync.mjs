const stable=value=>JSON.stringify(value,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const bodyOf=record=>({entry:record.entry,workingCopies:record.workingCopies||{},deleted:!!record.deleted});
export function projectRecords(projects,deletedProjects,storage){
 return [...projects.map(entry=>({entry,deleted:false})),...deletedProjects.map(entry=>({entry,deleted:true}))].map(record=>{
  const copies={};for(const route of record.entry.context.routes){try{const s=JSON.parse(storage.getItem('tx-letters-v2-'+record.entry.context.project.id+'-'+record.entry.context.project.version+'-'+route.id));if(s?.input){const {importToken,syncError,...persistent}=s;copies[route.id]=persistent;}}catch{}}
  return {...record,workingCopies:copies};
 });
}
export function createDatabaseSync({request,storage,onStatus=()=>{},onError=()=>{}}){
 let ready=false,timer,chain=Promise.resolve();const revisions=new Map(),signatures=new Map(),pending=new Map();
 const remember=()=>storage.setItem('tx-database-sync',JSON.stringify([...revisions].map(([key,revision])=>({key,revision,signature:signatures.get(key)}))));
 const enqueue=records=>{if(!ready)return;for(const record of records){const key=record.entry.key;if(stable(bodyOf(record))!==signatures.get(key))pending.set(key,structuredClone(record));}
  if(pending.size){onStatus('saving');clearTimeout(timer);timer=setTimeout(()=>flush().catch(onError),300);timer?.unref?.();}
 };
 const flush=()=>{clearTimeout(timer);if(!ready)return Promise.resolve();
  chain=chain.catch(()=>{}).then(async()=>{
   while(pending.size){const [key,record]=pending.entries().next().value,signature=stable(bodyOf(record));
    try{const r=await request('/api/v1/projects',{...bodyOf(record),expectedRevision:revisions.get(key)});revisions.set(key,r.revision);signatures.set(key,signature);if(pending.get(key)===record)pending.delete(key);remember();}
    catch(error){onStatus('error');throw error;}
   }onStatus('saved');
  });return chain;
 };
 return {enqueue,flush,
  async load(localRecords){
   const result=await request('/api/v1/projects');if(result.engine!=='postgresql'){onStatus('local');return null;}
   let metadata=[];try{metadata=JSON.parse(storage.getItem('tx-database-sync')||'[]')}catch{}
   const old=new Map(metadata.map(x=>[x.key,x])),records=new Map(result.records.map(x=>[x.key,x]));
   if(localRecords.length)storage.setItem('tx-before-database-'+crypto.randomUUID(),JSON.stringify({at:new Date().toISOString(),records:localRecords}));
   for(const record of localRecords){const key=record.entry.key,remote=records.get(key),prior=old.get(key),signature=stable(bodyOf(record));
    if(!remote||!remote.hidden&&prior&&remote.revision===prior.revision&&signature!==prior.signature){const r=await request('/api/v1/projects',{...bodyOf(record),expectedRevision:remote?.revision});records.set(key,{...record,key,revision:r.revision});}
   }
   for(const [key,record] of records){revisions.set(key,record.revision);signatures.set(key,stable(bodyOf(record)));}
   ready=true;remember();onStatus('saved');return [...records.values()];
  },
  async reset(key){await flush();if(!ready)return;const r=await request('/api/v1/projects',{action:'reset',key,expectedRevision:revisions.get(key)});revisions.set(key,r.revision);signatures.delete(key);pending.delete(key);remember();},
  get enabled(){return ready;}
 };
}
