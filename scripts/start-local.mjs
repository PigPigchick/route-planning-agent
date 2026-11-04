import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawn, spawnSync} from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const state = path.join(root, '.local-data');
const address = 'http://127.0.0.1:5173/#letters';
const statusOnly = process.argv.includes('--status');
const services = [
  {name: '后端', port: 4318, file: 'server.mjs', log: 'backend-launcher.log'},
  {name: '前端', port: 5173, file: 'frontend.mjs', log: 'frontend-launcher.log'}
];

async function healthy(service) {
  try {
    const response = await fetch(`http://127.0.0.1:${service.port}/` +
      (service.port === 4318 ? 'api/v1/storage' : ''), {signal: AbortSignal.timeout(2000)});
    if (!response.ok) return false;
    if (service.port === 4318) {
      const value = await response.json();
      return value.engine === 'postgresql' && value.connected && value.vector;
    }
    return (await response.text()).includes('src="app.mjs"');
  } catch { return false; }
}

function listenerRoot(port) {
  const result = spawnSync('/usr/sbin/lsof', ['-a', `-iTCP:${port}`, '-sTCP:LISTEN', '-Fp'], {encoding: 'utf8'});
  if (result.error || ![0, 1].includes(result.status)) throw new Error('无法检查端口占用，请查看系统权限。');
  const pids = result.stdout.split('\n').filter(line => /^p\d+$/.test(line)).map(line => line.slice(1));
  if (!pids.length) return [];
  const directories = spawnSync('/usr/sbin/lsof', ['-a', '-p', pids.join(','), '-d', 'cwd', '-Fn'], {encoding: 'utf8'});
  const owners = directories.stdout?.split('\n').filter(line => line.startsWith('n')).map(line => line.slice(1));
  if (directories.status !== 0 || !owners?.length) throw new Error('无法确认端口所属项目。');
  return owners;
}

try {
  if (Number(process.versions.node.split('.')[0]) < 22) throw new Error('需要 Node.js 22 或更高版本。');
  await fs.mkdir(state, {recursive: true});
  for (const service of services) {
    const owners = listenerRoot(service.port);
    if (owners.some(owner => owner !== root)) throw new Error(`${service.port} 端口由其他项目占用，请先检查该程序。`);
    if (await healthy(service)) {
      console.log(`${service.name}：运行正常（${service.port}）`);
      continue;
    }
    if (statusOnly) throw new Error(`${service.name}尚未就绪，请运行“启动输电设计系统.command”。`);
    if (owners.length) throw new Error(`${service.name}端口已占用但健康检查未通过，请查看 .local-data 中的日志。`);
    const logPath = path.join(state, service.log);
    const log = await fs.open(logPath, 'a', 0o600);
    try {
      const child = spawn(process.execPath, [path.join(root, service.file)], {
        cwd: root, env: {...process.env, PORT: '4318', FRONTEND_PORT: '5173'},
        detached: true, stdio: ['ignore', log.fd, log.fd]
      });
      await new Promise((resolve, reject) => { child.once('spawn', resolve); child.once('error', reject); });
      child.unref();
      let ready = false;
      for (let attempt = 0; attempt < 60; attempt++) {
        if (await healthy(service)) { ready = true; break; }
        await new Promise(resolve => setTimeout(resolve, 500));
      }
      if (!ready) throw new Error(`${service.name}启动失败，日志：${logPath}`);
      console.log(`${service.name}：已启动（${service.port}）`);
    } finally { await log.close(); }
  }
  console.log(`\n系统已就绪：${address}`);
  if (!statusOnly && !process.argv.includes('--no-open')) {
    const opened = spawn('open', [address], {stdio: 'ignore'});
    opened.on('error', () => console.log('请在浏览器打开上面的地址。'));
  }
} catch (error) {
  console.error(`\n系统未就绪：${error.message}`);
  process.exitCode = 1;
}
