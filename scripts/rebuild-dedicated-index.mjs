import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {openRepository} from '../backend/database.mjs';
import {knowledgeStore} from '../backend/knowledge.mjs';
import {loadLocalEnv,modelStore} from '../backend/model.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const state=path.join(root,'.local-data');
const apply=process.argv.includes('--apply');
await loadLocalEnv(root);
if(!process.env.TX_DATABASE_URL)throw new Error('请先配置 PostgreSQL');
if(!process.env.EMBEDDING_BASE_URL)throw new Error('请先配置独立向量服务 EMBEDDING_BASE_URL');
const model=await modelStore(state);
const repository=await openRepository(state);
try{
 const knowledge=await knowledgeStore(repository,model);
 const {baseUrl}=knowledge.settings();
 if(apply)await knowledge.test();
 const result=await knowledge.rebuildDedicatedIndex({apply});
 console.log(JSON.stringify({service:baseUrl,mode:apply?'重建':'预览',...result},null,2));
}finally{await repository.close();}
