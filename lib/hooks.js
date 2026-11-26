import {randomUUID,randomBytes,createHmac} from 'node:crypto';
import {mode,transaction,setting,save,seal,unseal,bad} from './db.js';
const key='hook:'+mode;
function allowed(input){
 let u;try{u=new URL(input);}catch{bad(400,'Masukkan URL HTTPS yang valid.');}
 const hosts=(process.env.WEBHOOK_HOSTS||'').split(',').map(h=>h.trim().toLowerCase());
 if(u.protocol!=='https:'||u.port||u.username||u.password||u.hash||!hosts.includes(u.hostname))bad(400,'Domain HTTPS harus tercantum dalam WEBHOOK_HOSTS.');
 return u.href;
}
export async function hookInfo(q){const raw=await setting(q,key);return raw?{url:unseal(raw).url}:{url:''};}
export async function setHook(q,url){if(!url){await q('DELETE FROM lp_settings WHERE id=$1',[key]);return {url:''};}const config={url:allowed(url),secret:'whsec_'+randomBytes(32).toString('hex')};await save(q,key,seal(config));return config;}
export async function enqueue(q,type,data){
 const raw=await setting(q,key);if(!raw)return;
 const c=unseal(raw),id=randomUUID(),now=Date.now(),body=JSON.stringify({id,type,mode,created_at:new Date(now).toISOString(),data});
 await q('INSERT INTO lp_events(id,mode,url,secret,body,state,attempts,next) VALUES($1,$2,$3,$4,$5,$6,0,$7)',[id,mode,c.url,seal(c.secret),body,'queued',now]);
}
export async function deliver(limit=3,send=fetch){
 for(let i=0;i<limit;i++){
   const item=await transaction(async q=>{
     const row=(await q("SELECT * FROM lp_events WHERE mode=$1 AND state IN ('queued','sending') AND next<=$2 ORDER BY next LIMIT 1",[mode,Date.now()]))[0];if(!row)return;
     row.lease=randomUUID();await q("UPDATE lp_events SET state='sending',lease=$1,attempts=attempts+1,next=$2 WHERE id=$3",[row.lease,Date.now()+30000,row.id]);return row;
   });if(!item)return;
   let code=0;try{
     const url=allowed(item.url),ts=Math.floor(Date.now()/1000).toString(),sig=createHmac('sha256',unseal(item.secret)).update(ts+'.'+item.body).digest('hex');
     const res=await send(url,{method:'POST',redirect:'error',signal:AbortSignal.timeout(4000),headers:{'Content-Type':'application/json','Louiv-Event-Id':item.id,'Louiv-Timestamp':ts,'Louiv-Signature':'v1='+sig},body:item.body});code=res.status;await res.body?.cancel();
   }catch{}
   const attempts=Number(item.attempts)+1,state=code>=200&&code<300?'delivered':attempts>=6?'failed':'queued';
   await transaction(q=>q('UPDATE lp_events SET state=$1,next=$2,code=$3,lease=NULL WHERE id=$4 AND lease=$5',[state,Date.now()+Math.min(3600000,15000*2**attempts),code,item.id,item.lease]));
 }
}
