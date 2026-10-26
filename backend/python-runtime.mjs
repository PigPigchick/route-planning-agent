import fs from 'node:fs/promises';
import path from 'node:path';
import {homedir} from 'node:os';

// A project virtual environment travels as setup instructions, not as copied binaries.
export async function resolveExportPython(root,{env=process.env,platform=process.platform,home=homedir()}={}){
 if(env.TX_PYTHON?.trim())return env.TX_PYTHON.trim();
 const paths=platform==='win32'?path.win32:path.posix;
 const candidates=[
  platform==='win32'?paths.join(root,'.venv','Scripts','python.exe'):paths.join(root,'.venv','bin','python'),
  paths.join(home,'.cache','codex-runtimes','codex-primary-runtime','dependencies','python',platform==='win32'?'python.exe':'bin/python3')
 ];
 for(const candidate of candidates){try{if((await fs.stat(candidate)).isFile())return candidate;}catch(e){if(!['ENOENT','ENOTDIR'].includes(e.code))throw e;}}
 return platform==='win32'?'python':'python3';
}
