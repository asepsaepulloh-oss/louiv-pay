import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomBytes} from 'node:crypto';
Object.assign(process.env,{PAY_MODE:'sandbox',DATABASE_URL:'',LOCAL_DB:':memory:',ADMIN_KEY:randomBytes(32).toString('hex'),DATA_KEY:randomBytes(32).toString('hex'),WEBHOOK_HOSTS:'merchant.example',CRON_SECRET:'test-job',APP_URL:'https://pay.example'});
delete process.env.VERCEL;delete process.env.RAILWAY_ENVIRONMENT_ID;
const {default:gateway}=await import('../api/gateway.js');
async function call(path,{body,headers={},cookie}={}){
 let status,data;const meta={};await gateway({url:'/api/'+path,method:body?'POST':'GET',headers:{'x-louiv-client':'dashboard',...headers,cookie},body},{setHeader(k,v){meta[k]=v;},writeHead(s){status=s;return this;},end(s){data=JSON.parse(s);}});
 return {status,data,cookie:meta['Set-Cookie']?.split(';')[0]};
}
test('Dashboard, transaksi, checkout, signature webhook, retry, cabut key dan logout',async()=>{
 assert.equal((await call('dashboard')).status,401);
 const {cookie}=await call('login',{body:{key:process.env.ADMIN_KEY}});assert.ok(cookie);
 const admin=(path,body)=>call(path,{cookie,body});
 const key=(await admin('keys',{name:'Integrasi toko'})).data.secret;
 assert.ok(key.startsWith('lp_sandbox_'));
 assert.equal((await admin('hooks',{url:'https://unknown.example/test'})).status,400);
 const hook=(await admin('hooks',{url:'https://merchant.example/events'})).data;
 const messages=[];let response=200;
 const original=globalThis.fetch;globalThis.fetch=async(url,opts)=>{
   assert.equal(url,hook.url);const ts=opts.headers['Louiv-Timestamp'];
   assert.equal(opts.headers['Louiv-Signature'],'v1='+createHmac('sha256',hook.secret).update(ts+'.'+opts.body).digest('hex'));
   messages.push(JSON.parse(opts.body));return {status:response};
 };
 try{
  const headers={authorization:'Bearer '+key,'idempotency-key':'pesanan-1001'};
  const body={reference:'Pesanan 1001',amount:25000,channel:'shopee'};
  const p=(await call('v1/payments',{headers,body})).data;
  assert.equal(p.total,25001);assert.equal(p.status,'pending');assert.equal(messages[0].type,'payment.created');
  assert.equal((await call('v1/payments',{headers,body})).data.id,p.id);
  assert.equal((await call('v1/payments',{headers,body:{...body,amount:26000}})).status,409);
  assert.equal((await call('checkout?id='+p.id)).data.qr,null);
  assert.equal((await admin('simulate',{id:p.id})).status,200);assert.equal(messages.at(-1).type,'payment.paid');
  assert.equal((await call('v1/payments/'+p.id,{headers})).data.status,'paid');
  response=503;await admin('hooks/test',{});let dash=(await admin('dashboard')).data;
  assert.equal(Number(dash.stats.revenue),25001);const ev=dash.events.find(e=>e.type==='webhook.test');assert.equal(ev.state,'queued');assert.equal(ev.code,503);
  response=200;await admin('hooks/retry',{id:ev.id});dash=(await admin('dashboard')).data;assert.equal(dash.events.find(e=>e.id===ev.id).state,'delivered');
  assert.equal(messages.filter(m=>m.id===ev.id).length,2);
  assert.equal((await call('channels/login',{cookie,body:{step:'phone',channel:'shopee'}})).status,409);
  await admin('keys/revoke',{id:dash.keys[0].id});assert.equal((await call('v1/payments/'+p.id,{headers})).status,401);
  assert.equal((await call('jobs/run',{body:{},headers:{authorization:'Bearer test-job'}})).status,200);
  await admin('logout',{});assert.equal((await admin('dashboard')).status,401);
 }finally{globalThis.fetch=original;}
});
