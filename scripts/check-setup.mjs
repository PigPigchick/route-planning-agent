import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn} from 'node:child_process';
import {resolveExportPython} from '../backend/python-runtime.mjs';
import {loadLocalEnv} from '../backend/model.mjs';

const root=path.dirname(path.dirname(fileURLToPath(import.meta.url)));
try{
 if(Number(process.versions.node.split('.')[0])<22)throw new Error('请安装 Node.js 22 或更新版本');
 console.log('Node.js：'+process.version+'，符合要求');
 for(const name of ['dist/index.html','dist/app.mjs','dist/letters-ui.mjs','backend/export_letters.py'])await fs.access(path.join(root,name));
 console.log('前端与后端文件：完整');
 await loadLocalEnv(root);
 const python=await resolveExportPython(root);
 const version=await new Promise((resolve,reject)=>{
  const child=spawn(python,['-c','import sys; import docx; assert sys.version_info >= (3, 10), "Python 3.10+ required"; print(sys.version.split()[0] + " / python-docx " + docx.__version__)'],{stdio:['ignore','pipe','pipe'],timeout:15000});
  let output='';child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',()=>{});
  child.on('error',()=>reject(new Error('无法运行 Python；请按迁移说明创建 .venv，或设置 TX_PYTHON')));
  child.on('close',code=>code===0?resolve(output.trim()):reject(new Error('Python 或 python-docx 未就绪；请按迁移说明在 .venv 中安装 requirements.txt')));
 });
 console.log('Word 导出：Python '+version);
 console.log('环境检查通过。分别运行 npm run dev:backend 和 npm run dev:frontend，再打开 http://127.0.0.1:5173/#letters');
}catch(error){console.error('环境检查未通过：'+error.message);process.exitCode=1;}
