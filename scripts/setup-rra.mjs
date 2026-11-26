import {execFileSync} from 'node:child_process';
import fs from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {findRraRuntime} from '../backend/rra-runtime.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const revision = '04f4fa89eddc5013a3fa10d31391a7e9a13bc3eb';
const upstream = 'https://github.com/qspang/RRA.git';
const base = path.join(root, 'services', 'rra');
const destination = path.join(base, 'runtime');
const existing = await findRraRuntime(root);
if (existing) {
 console.log('RRA 已安装：'+existing);
 process.exit(0);
}

const work = await fs.mkdtemp(path.join(tmpdir(), 'tx-rra-source-'));
let staging;
function git(args, cwd) {
 return execFileSync('git', args, {cwd, env:{...process.env,GIT_TERMINAL_PROMPT:'0'}, encoding:'utf8'});
}
try {
 const checkout = path.join(work, 'upstream');
 await fs.mkdir(checkout);
 git(['init','--quiet'], checkout);
 git(['fetch','--quiet','--depth=1',upstream,revision], checkout);
 const fetched = git(['rev-parse','FETCH_HEAD'], checkout).trim();
 if (fetched !== revision) throw new Error('下载的 RRA 提交和固定版本不一致');
 git(['checkout','--quiet','--detach',fetched], checkout);

 const runtime = path.join(work, 'runtime');
 await fs.mkdir(runtime);
 const components = [
  '.env.example', 'README.md', 'assets', 'configs', 'docs', 'report_agents',
  'requirements.txt', 'requirements-lock.txt', 'road_description', 'roaddata',
  'run.sh', 'templates', 'tests', 'tools',
 ];
 for (const name of components) {
  await fs.cp(path.join(checkout,'RoadDescription',name), path.join(runtime,name), {recursive:true});
 }
 const patch = path.join(base,'studio.patch');
 git(['apply','--unidiff-zero','--check',patch], runtime);
 git(['apply','--unidiff-zero',patch], runtime);
 await fs.writeFile(path.join(runtime,'STUDIO_UPSTREAM.txt'), upstream+'\n'+revision+'\n');

 staging = await fs.mkdtemp(path.join(base,'.install-'));
 const ready = path.join(staging,'runtime');
 await fs.cp(runtime, ready, {recursive:true});
 await fs.rename(ready, destination);
 console.log('RRA 安装完成：'+destination);
 console.log('依赖安装与工程配置见 services/rra/STUDIO.md。');
} finally {
 await fs.rm(work, {recursive:true,force:true});
 if (staging) await fs.rm(staging, {recursive:true,force:true});
}
