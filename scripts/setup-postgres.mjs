import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {spawnSync} from 'node:child_process';
import {randomBytes} from 'node:crypto';
import pg from 'pg';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const bin=process.env.TX_PG_BIN||'/Applications/Postgres.app/Contents/Versions/18/bin';
const state=path.join(root,'.local-data'),data=path.join(state,'postgres'),socket='/private/tmp/tx-studio-pg5432';
await fs.mkdir(state,{recursive:true});await fs.mkdir(socket,{recursive:true,mode:0o700});
const run=(name,args)=>{const r=spawnSync(path.join(bin,name),args,{encoding:'utf8'});if(r.status!==0)throw new Error((r.stderr||r.stdout||r.error?.message||'PostgreSQL命令失败').trim());return r.stdout;};
try{await fs.access(path.join(bin,'initdb'))}catch{throw new Error('请先安装官方Postgres.app，或通过TX_PG_BIN指定PostgreSQL bin目录');}
let password;
try{password=(await fs.readFile(path.join(state,'postgres-password'),'utf8')).trim()}catch(e){if(e.code!=='ENOENT')throw e;password=randomBytes(30).toString('base64url');await fs.writeFile(path.join(state,'postgres-password'),password,{mode:0o600});}
try{await fs.access(path.join(data,'PG_VERSION'))}catch(e){if(e.code!=='ENOENT')throw e;
 run('initdb',['-D',data,'-U','tx_studio','--pwfile='+path.join(state,'postgres-password'),'--auth-host=scram-sha-256','--auth-local=scram-sha-256','--encoding=UTF8','--locale=C']);
 await fs.appendFile(path.join(data,'postgresql.conf'),`\nlisten_addresses = '127.0.0.1'\nport = 5432\nunix_socket_directories = '${socket}'\n`);
}
const status=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{encoding:'utf8'});
if(status.status!==0)run('pg_ctl',['-D',data,'-l',path.join(state,'postgres.log'),'-w','start']);
const admin=new pg.Client({host:'127.0.0.1',port:5432,user:'tx_studio',password,database:'postgres'});await admin.connect();
try{if(!(await admin.query("SELECT 1 FROM pg_database WHERE datname='transmission_studio'")).rowCount)await admin.query('CREATE DATABASE transmission_studio');}finally{await admin.end();}
const url='postgresql://tx_studio:'+encodeURIComponent(password)+'@127.0.0.1:5432/transmission_studio';
const client=new pg.Client({connectionString:url});await client.connect();
try{await client.query('CREATE EXTENSION IF NOT EXISTS vector');const r=await client.query("SELECT current_database() AS database,(SELECT extversion FROM pg_extension WHERE extname='vector') AS vector");console.log(JSON.stringify({installed:true,host:'127.0.0.1',port:5432,...r.rows[0]}));}finally{await client.end();}
const envFile=path.join(root,'.env.local');let env='';try{env=await fs.readFile(envFile,'utf8')}catch(e){if(e.code!=='ENOENT')throw e;}
env=env.replace(/^TX_DATABASE_URL=.*\n?/gm,'');await fs.writeFile(envFile,env.trimEnd()+'\nTX_DATABASE_URL='+url+'\n',{mode:0o600});await fs.chmod(envFile,0o600);
console.log('已写入本机数据库配置，未显示密码。数据库仅监听本机。');
