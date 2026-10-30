import fs from 'node:fs/promises';
import path from 'node:path';
import {spawnSync} from 'node:child_process';

export async function ensureLocalPostgres(root){
 if(!process.env.TX_DATABASE_URL||process.env.TX_DATA_DIR)return;
 const url=new URL(process.env.TX_DATABASE_URL);if(url.hostname!=='127.0.0.1'||url.port!=='5432'||url.pathname!=='/transmission_studio')return;
 const data=path.join(root,'.local-data','postgres'),bin=process.env.TX_PG_BIN||'/Applications/Postgres.app/Contents/Versions/18/bin';
 try{await fs.access(path.join(data,'PG_VERSION'));await fs.access(path.join(bin,'pg_ctl'))}catch{return;}
 const status=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'status'],{encoding:'utf8'});if(status.status===0)return;
 await fs.mkdir('/private/tmp/tx-studio-pg5432',{recursive:true,mode:0o700});
 const r=spawnSync(path.join(bin,'pg_ctl'),['-D',data,'-l',path.join(root,'.local-data','postgres.log'),'-w','start'],{encoding:'utf8',timeout:30000});
 if(r.status!==0)throw new Error('本机PostgreSQL启动失败，请运行 npm run setup:database 检查安装');
}
