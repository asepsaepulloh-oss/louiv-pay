import http from 'node:http';
import {randomBytes} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import gateway from './api/gateway.js';
const local=!process.env.RAILWAY_ENVIRONMENT_ID&&!process.env.VERCEL&&!process.env.DATABASE_URL&&(process.env.PAY_MODE||'sandbox')==='sandbox';
if(local){
 const path='.local-secrets.json';
 if(!existsSync(path))writeFileSync(path,JSON.stringify({ADMIN_KEY:randomBytes(24).toString('hex'),DATA_KEY:randomBytes(32).toString('hex')}),{mode:0o600,flag:'wx'});
 const defaults=JSON.parse(readFileSync(path));for(const [k,v] of Object.entries(defaults))process.env[k]||=v;
 console.log('Dashboard lokal: gunakan ADMIN_KEY dari .local-secrets.json');
}
const files=new Set(['index.html','app.js','style.css','checkout.html','checkout.js']);
http.createServer(async(req,res)=>{
 const path=new URL(req.url,'http://localhost').pathname;
 if(path.startsWith('/api/'))return gateway(req,res);
 const file=path==='/'?'index.html':path.slice(1);
 if(req.method!=='GET'||!files.has(file))return res.writeHead(404).end();
 try{const body=await readFile(new URL('./public/'+file,import.meta.url));res.writeHead(200,{'Content-Type':({'html':'text/html','js':'text/javascript','css':'text/css'})[file.split('.').pop()]+'; charset=utf-8','Referrer-Policy':'no-referrer','X-Frame-Options':'DENY'}).end(body);}catch{res.writeHead(500).end();}
}).listen(Number(process.env.PORT||3000),local?'127.0.0.1':'0.0.0.0');
