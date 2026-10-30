import {validateContext} from '../dist/engine.mjs';
import {validateLettersInput} from '../dist/letters-core.mjs';
const keyOf=context=>JSON.stringify([context.project.id,context.project.version]);
export function validateProjectRecord(record){
 validateContext(record?.entry?.context);const {context}=record.entry;
 if(!context.project.version)throw new Error('工程版本不能为空');
 const key=keyOf(context);if(record.entry.key!==key)throw new Error('工程编号与保存位置不一致');
 if(!context.routes.some(r=>r.id===record.entry.routeId))throw new Error('当前路径不存在');
 const copies=record.workingCopies||{};
 if(!copies||typeof copies!=='object'||Array.isArray(copies))throw new Error('工程工作资料格式无效');
 for(const [routeId,state] of Object.entries(copies)){
  validateLettersInput(state?.input,{allowEmpty:true});
  if(state.input.project.id!==context.project.id||state.input.project.version!==context.project.version||state.input.route.id!==routeId||!context.routes.some(r=>r.id===routeId))throw new Error('协议清单与工程或路径不一致');
 }
 return key;
}
export async function projectStore(repository){
 if(!repository.pool)return null;
 const pool=repository.pool;
 return {
  async list(){return (await pool.query('SELECT id,revision,payload FROM tx_projects ORDER BY updated_at')).rows.map(row=>({...row.payload,key:row.id,revision:row.revision}));},
  async save(body){
   const id=validateProjectRecord(body),c=await pool.connect();
   try{await c.query('BEGIN');await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))',[id]);const old=(await c.query('SELECT revision,payload FROM tx_projects WHERE id=$1 FOR UPDATE',[id])).rows[0];
    if(old&&body.expectedRevision!==old.revision)throw Object.assign(new Error('工程已在其他窗口更新，请重新加载工程后再保存；当前输入仍保留在浏览器中'),{status:409});
    const payload={entry:body.entry,workingCopies:body.workingCopies||{},deleted:!!body.deleted,hidden:false};
    const row=(await c.query('INSERT INTO tx_projects(id,payload) VALUES($1,$2) ON CONFLICT(id) DO UPDATE SET payload=EXCLUDED.payload,revision=tx_projects.revision+1,updated_at=now() RETURNING revision',[id,JSON.stringify(payload)])).rows[0];
    await c.query('COMMIT');return {key:id,revision:row.revision};
   }catch(e){await c.query('ROLLBACK');throw e;}finally{c.release();}
  },
  async reset(body){
   if(typeof body.key!=='string')throw new Error('工程编号无效');
   const row=(await pool.query("UPDATE tx_projects SET payload=jsonb_set(payload,'{hidden}','true'),revision=revision+1,updated_at=now() WHERE id=$1 AND revision=$2 RETURNING revision",[body.key,body.expectedRevision])).rows[0];
   if(!row)throw Object.assign(new Error('工程已更新，请重新加载后重试'),{status:409});
   return {key:body.key,revision:row.revision};
  }
 };
}
