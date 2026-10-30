import {spawn} from 'node:child_process';
import path from 'node:path';
import {resolveExportPython} from './python-runtime.mjs';

export async function readLetterWorkbook(root, body) {
  if (!String(body.name || '').toLowerCase().endsWith('.xlsx')) throw new Error('请选择 .xlsx 文件；旧版 .xls 请先另存为 .xlsx');
  if (typeof body.base64 !== 'string' || body.base64.length > 8 * 1024 * 1024 || !/^[A-Za-z0-9+/]*={0,2}$/.test(body.base64)) throw new Error('Excel文件编码无效或超过6MB');
  const bytes = Buffer.from(body.base64, 'base64');
  if (!bytes.length || bytes.length > 6 * 1024 * 1024) throw new Error('Excel文件须为1字节至6MB');
  const python = await resolveExportPython(root);
  return await new Promise((resolve, reject) => {
    const child = spawn(python, [path.join(root, 'backend/read_letter_xlsx.py')], {stdio: ['pipe', 'pipe', 'pipe'], timeout: 20000});
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; if (output.length > 5 * 1024 * 1024) child.kill(); });
    child.on('error', () => reject(new Error('无法读取Excel，请检查后端Python环境')));
    child.on('close', code => {
      try { const data = JSON.parse(output); if (code !== 0 || data.error) throw new Error(data.error || 'Excel解析失败'); resolve(data); }
      catch (error) { reject(new Error(error.message.startsWith('Unexpected') ? 'Excel文件损坏或格式不支持' : error.message)); }
    });
    child.stdin.on('error', () => {});
    child.stdin.end(bytes);
  });
}
