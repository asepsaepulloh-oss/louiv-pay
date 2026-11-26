import {randomBytes,randomUUID} from 'node:crypto';
import {transaction,mode,equal,digest,bad} from '../lib/db.js';
import {channel,loginStep} from '../lib/channels.js';
import {createOrder,getOrder,publicOrder,simulate,reconcile} from '../lib/payments.js';
import {hookInfo,setHook,enqueue,deliver} from '../lib/hooks.js';
const token=()=>randomBytes(32).toString('hex');
async function json(req){
 if(req.body&&typeof req.body==='object')return req.body;
 let s=typeof req.body==='string'?req.body:'';if(!s)for await(const chunk of req){s+=chunk;if(s.length>12000)bad(413,'Data terlalu panjang.');}
 try{return s?JSON.parse(s):{};}catch{bad(400,'Format JSON salah.');}
}
const admin=async(q,req)=>{const cookie=(req.headers.cookie||'').match(/(?:^|;\s*)lp_session=([a-f0-9]{64})(?:;|$)/)?.[1];if(!cookie||!(await q('SELECT token FROM lp_sessions WHERE token=$1 AND expires>$2',[digest(cookie),Date.now()])).length)bad(401,'Silakan masuk ke dashboard.');return digest(cookie);};
async function authenticate(q,req){
 if(!req.headers.authorization)return admin(q,req);
 const secret=req.headers.authorization.replace(/^Bearer /,'');
 if(!(await q('SELECT id FROM lp_keys WHERE digest=$1 AND mode=$2 AND revoked=0',[digest(secret),mode])).length)bad(401,'API key tidak valid.');
}
const cookieAttr=()=>'; HttpOnly; SameSite=Strict; Path=/'+(process.env.APP_URL?.startsWith('https:')||process.env.VERCEL||process.env.RAILWAY_ENVIRONMENT_ID?'; Secure':'');
async function run(req,res){
 const url=new URL(req.url,'http://localhost'),path=url.pathname==='/api/gateway'?'/'+(url.searchParams.get('route')||''):url.pathname.replace(/^\/api/,'');
 const post=req.method==='POST';if(!post&&req.method!=='GET')bad(405,'Metode tidak tersedia.');
 if(path==='/mode'&&!post)return {mode};
 if(!/^[a-f0-9]{64}$/i.test(process.env.DATA_KEY||'')||(process.env.ADMIN_KEY||'').length<32)bad(503,'Konfigurasikan DATA_KEY dan ADMIN_KEY.');
 if(post&&!req.headers.authorization&&req.headers['x-louiv-client']!=='dashboard')bad(403,'Permintaan tidak diizinkan.');
 const b=post?await json(req):{};
 if(path==='/jobs/run'&&post){
   if(!process.env.CRON_SECRET||!equal(req.headers.authorization||'','Bearer '+process.env.CRON_SECRET))bad(401,'Akses ditolak.');
   const results={};for(const n of ['gopay','shopee']){try{await transaction(q=>reconcile(q,n));results[n]='ok';}catch{results[n]='error';}}
   await deliver();if(Object.values(results).includes('error'))bad(503,'Satu kanal gagal disinkronkan.');return results;
 }
 const result=await transaction(async q=>{
  if(path==='/login'&&post){
    if(!equal(String(b.key||''),process.env.ADMIN_KEY))bad(401,'Kunci dashboard salah.');
    await q('DELETE FROM lp_sessions WHERE expires<$1',[Date.now()]);
    const secret=token();await q('INSERT INTO lp_sessions(token,expires) VALUES($1,$2)',[digest(secret),Date.now()+28800000]);
    res.setHeader('Set-Cookie','lp_session='+secret+cookieAttr()+'; Max-Age=28800');return {ok:true};
  }
  if(path==='/checkout'&&!post){
   let p=await getOrder(q,url.searchParams.get('id')||'');if(!p)bad(404,'Tagihan tidak ditemukan.');
   if(p.status==='pending'){await reconcile(q,p.channel);p=await getOrder(q,p.id);}
   const qr=p.qrString&&p.status==='pending'&&Date.now()<p.expiresAt?await (await import('qrcode')).default.toDataURL(p.qrString,{width:320,margin:4}):null;
   return {...publicOrder(p),mode,qr};
  }
  if(path==='/v1/payments'&&post){await authenticate(q,req);return createOrder(q,b,req.headers['idempotency-key']);}
  if(path.startsWith('/v1/payments/')&&!post){await authenticate(q,req);let p=await getOrder(q,path.split('/').at(-1));if(!p)bad(404,'Tagihan tidak ditemukan.');if(p.status==='pending'){await reconcile(q,p.channel);p=await getOrder(q,p.id);}return publicOrder(p);}
  const sid=await admin(q,req);
  if(path==='/logout'&&post){await q('DELETE FROM lp_sessions WHERE token=$1',[sid]);res.setHeader('Set-Cookie','lp_session='+cookieAttr()+'; Max-Age=0');return {ok:true};}
  if(path==='/dashboard'&&!post){
   const data=await q('SELECT data FROM lp_orders WHERE mode=$1 ORDER BY created DESC LIMIT 200',[mode]);
   const stats=(await q("SELECT count(*) AS orders,coalesce(sum(CASE WHEN status='paid' THEN total ELSE 0 END),0) AS revenue,coalesce(sum(CASE WHEN status='pending' THEN 1 ELSE 0 END),0) AS pending FROM lp_orders WHERE mode=$1",[mode]))[0];
   const channels={};for(const n of ['gopay','shopee'])channels[n]=(await channel(q,n))?.label||null;
   return {mode,stats,orders:data.map(r=>publicOrder(JSON.parse(r.data))),channels,keys:await q('SELECT id,name,prefix,created,revoked FROM lp_keys WHERE mode=$1 ORDER BY created DESC',[mode]),hook:await hookInfo(q),events:(await q('SELECT id,body,state,attempts,code FROM lp_events WHERE mode=$1 ORDER BY next DESC LIMIT 50',[mode])).map(({body,...r})=>({...r,type:JSON.parse(body).type}))};
  }
  if(path==='/keys'&&post){if(!b.name?.trim()||b.name.length>60)bad(400,'Beri nama API key.');const secret='lp_'+mode+'_'+token();await q('INSERT INTO lp_keys(id,mode,name,digest,prefix,created) VALUES($1,$2,$3,$4,$5,$6)',[randomUUID(),mode,b.name.trim(),digest(secret),secret.slice(0,18),Date.now()]);return {secret};}
  if(path==='/keys/revoke'&&post){await q('UPDATE lp_keys SET revoked=1 WHERE id=$1 AND mode=$2',[b.id,mode]);return {ok:true};}
  if(path==='/hooks'&&post)return setHook(q,b.url);
  if(path==='/hooks/test'&&post){if(!(await hookInfo(q)).url)bad(400,'Simpan endpoint terlebih dahulu.');await enqueue(q,'webhook.test',{message:'Uji pengiriman Louiv Pay'});return {ok:true};}
  if(path==='/hooks/retry'&&post){await q("UPDATE lp_events SET state='queued',attempts=0,next=$1 WHERE id=$2 AND mode=$3 AND state IN ('failed','queued')",[Date.now(),b.id,mode]);return {ok:true};}
  if(path==='/simulate'&&post){await simulate(q,b.id);return {ok:true};}
  if(path==='/channels/login'&&post){
    if(mode!=='live')bad(409,'Aktifkan PAY_MODE=live untuk login provider.');
    try{return await loginStep(q,b);}catch(e){
      if(e.expose)throw e;
      if(e.code==='CAPTCHA_REQUIRED')bad(409,'Provider meminta CAPTCHA. Selesaikan pemeriksaan melalui layanan resmi provider.');
      if(e.code==='AUTH_FAILED'||e.code==='AUTH_REQUIRED')bad(422,'Provider menolak login. Periksa nomor atau kredensial akun.');
      bad(502,'Provider belum menyelesaikan proses login. Coba lagi setelah memeriksa akun merchant.');
    }
  }
  bad(404,'Rute tidak ditemukan.');
 });
 if(result?.loginError)bad(400,result.loginError);
 if(post&&['/hooks/test','/hooks/retry','/simulate','/v1/payments'].includes(path))await deliver(1).catch(()=>{});
 return result;
}
export default async function gateway(req,res){let status=200,data;try{data=await run(req,res);}catch(e){status=e.expose?e.status:503;data={error:e.expose?e.message:'Layanan belum tersedia. Periksa konfigurasi atau koneksi provider.'};}res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}).end(JSON.stringify(data));}

