import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {resolveExportPython} from './backend/python-runtime.mjs';

test('显式 Python 配置优先，保留包含空格的可执行文件路径',async()=>{
 assert.equal(await resolveExportPython('/app',{env:{TX_PYTHON:' /custom path/python3 '}}),'/custom path/python3');
});
test('优先识别项目虚拟环境，解压到新目录后不依赖旧绝对路径',async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'tx portable '));
 try{
  const python=path.join(root,'.venv','bin','python');await fs.mkdir(path.dirname(python),{recursive:true});await fs.writeFile(python,'');
  assert.equal(await resolveExportPython(root,{env:{},platform:'darwin',home:root}),python);
  assert.equal(await resolveExportPython(root,{env:{},platform:'linux',home:root}),python);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
test('没有虚拟环境时兼容当前 Codex 环境，新设备使用系统 Python 命令',async()=>{
 const root=await fs.mkdtemp(path.join(tmpdir(),'tx-python-fallback-'));
 try{
  assert.equal(await resolveExportPython(root,{env:{},platform:'linux',home:root}),'python3');
  assert.equal(await resolveExportPython(root,{env:{},platform:'win32',home:root}),'python');
  const python=path.join(root,'.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3');
  await fs.mkdir(path.dirname(python),{recursive:true});await fs.writeFile(python,'');
  assert.equal(await resolveExportPython(root,{env:{},platform:'darwin',home:root}),python);
 }finally{await fs.rm(root,{recursive:true,force:true});}
});
