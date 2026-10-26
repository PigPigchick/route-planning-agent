"""Build a source release with an explicit allowlist; never copy runtime state."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, io, json, re, zipfile

ROOT=Path(__file__).resolve().parent.parent
ROOT_FILES=['package.json','requirements.txt','.env.example','.gitignore','README.md','LETTERS.md']
FOLDERS=['backend','dist','scripts','使用文档与样例']
BLOCKED={'.local-data','.git','node_modules','.venv','__pycache__','outputs','release','_build','.openai','analysis'}

def files():
 result={ROOT/name for name in ROOT_FILES}
 result.update(ROOT.glob('*.mjs'))
 for name in FOLDERS:
  for p in (ROOT/name).rglob('*'):
   if p.is_file() and not any(part in BLOCKED for part in p.relative_to(ROOT).parts) and p.name!='.DS_Store' and p.suffix!='.pyc':result.add(p)
 for p in result:
  if p.is_symlink() or not p.resolve().is_relative_to(ROOT):raise ValueError('发布文件不能是指向外部的链接：'+p.name)
 return sorted(result,key=lambda p:p.relative_to(ROOT).as_posix())

def check_content(name,body,secrets,depth=0):
 for secret in secrets:
  if secret and secret in body:raise ValueError('发现实际密钥，未打包：'+name)
 if name.endswith(('.mjs','.py','.json','.env.example','.txt','.md')):
  if re.search(rb'\bsk-[A-Za-z0-9][A-Za-z0-9._-]{18,}',body):raise ValueError('发现疑似实际密钥，未打包：'+name)
 if name.endswith(('.zip','.docx')) and depth<4:
  with zipfile.ZipFile(io.BytesIO(body)) as z:
   if z.testzip() is not None:raise ValueError('内部文件损坏：'+name)
   for member in z.namelist():check_content(member,z.read(member),secrets,depth+1)

if __name__=='__main__':
 parser=argparse.ArgumentParser();parser.add_argument('--output',default='release/输电设计工作台_完整迁移包.zip');args=parser.parse_args()
 target=Path(args.output)
 if not target.is_absolute():target=ROOT/target
 target.parent.mkdir(parents=True,exist_ok=True)
 secrets=[];local=ROOT/'.local-data/model-config.json'
 if local.exists():
  key=json.loads(local.read_text()).get('apiKey','')
  if key:secrets.append(key.encode())
 entries={}
 for source in files():
  name=source.relative_to(ROOT).as_posix();body=source.read_bytes();check_content(name,body,secrets);entries[name]=body
 env=entries['.env.example'].decode()
 if not re.search(r'^LLM_API_KEY=\s*$',env,re.M):raise ValueError('示例 API Key 必须为空')
 entries['交付信息.json']=json.dumps({'builtAt':datetime.now(timezone.utc).isoformat(),'frontend':'http://127.0.0.1:5173/','backend':'http://127.0.0.1:4318/','node':'>=22','python':'>=3.10','sourceEntry':'server.mjs','frontendEntry':'frontend.mjs','containsApiKey':False,'containsRuntimeHistory':False,'docs':'README.md'},ensure_ascii=False,indent=2).encode()
 manifest='\n'.join(hashlib.sha256(body).hexdigest()+'  '+name for name,body in sorted(entries.items()))+'\n'
 entries['文件清单.sha256']=manifest.encode()
 with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
  for name,body in sorted(entries.items()):z.writestr('transmission-studio-v3/'+name,body)
 with zipfile.ZipFile(target) as z:
  if z.testzip() is not None:raise ValueError('ZIP 完整性检查失败')
  if any(any(part in BLOCKED for part in Path(name).parts[1:]) for name in z.namelist()):raise ValueError('包中发现运行目录')
 print('发布包：'+str(target))
 print('文件数量：'+str(len(entries)))
 print('大小：'+str(round(target.stat().st_size/1024))+' KB')
 print('已检查 ZIP 完整性、空密钥配置和文件范围。')
