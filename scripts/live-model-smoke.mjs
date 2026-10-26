// Uses only the ignored local backend configuration. Never prints credentials or reasoning.
import path from 'node:path';import fs from 'node:fs/promises';
import {fileURLToPath} from 'node:url';import {modelStore,chatJSON} from '../backend/model.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const store=await modelStore(path.join(root,'.local-data'));let report;
try{const r=await chatJSON(store.get(),[{role:'system',content:'请只输出JSON对象，不要代码块。'},{role:'user',content:'这是接口连通性测试，请返回 {"ok":true,"message":"连接正常"}。'}]);report={ok:r.output.ok===true,model:r.model,stream:r.stream,thinkingMode:r.thinkingMode,durationMs:r.durationMs,usage:r.usage};}
catch(e){report={ok:false,error:e.message}}
await fs.mkdir(path.join(root,'outputs'),{recursive:true});await fs.writeFile(path.join(root,'outputs/model-connection-test.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));if(!report.ok)process.exitCode=1;
