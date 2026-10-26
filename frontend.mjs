import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.join(path.dirname(fileURLToPath(import.meta.url)),'dist'),port=Number(process.env.FRONTEND_PORT||5173);
const types={'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.md':'text/markdown; charset=utf-8','.json':'application/json; charset=utf-8'};
http.createServer(async(req,res)=>{try{if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return}const p=new URL(req.url,'http://localhost').pathname;const f=path.resolve(root,p==='/'?'index.html':decodeURIComponent(p.slice(1)));if(!f.startsWith(root+path.sep)){res.writeHead(403);res.end();return}const data=await fs.readFile(f);res.writeHead(200,{'Content-Type':types[path.extname(f)]||'application/octet-stream','Cache-Control':'no-cache','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self' http://127.0.0.1:* http://localhost:* https:; object-src 'none'; base-uri 'self'"});res.end(req.method==='HEAD'?undefined:data)}catch{res.writeHead(404);res.end('Not found')}}).listen(port,'127.0.0.1',()=>process.stdout.write(`输电设计工作台前端：http://127.0.0.1:${port}\n前端独立提供静态页面，通过 HTTP 连接后端 4318\n`));
