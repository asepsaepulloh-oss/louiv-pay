import {createHmac} from 'node:crypto';
import {mode,setting,save,bad,seal} from './db.js';
import {channel} from './channels.js';
import {enqueue} from './hooks.js';
export const publicOrder=p=>({id:p.id,reference:p.reference,amount:p.baseAmount,total:p.uniqueAmount,status:p.status,channel:p.channel,created_at:new Date(p.createdAt).toISOString(),expires_at:new Date(p.expiresAt).toISOString(),checkout_url:(process.env.APP_URL||'').replace(/\/$/,'')+'/checkout.html?id='+p.id});
export async function getOrder(q,id){const row=(await q('SELECT data FROM lp_orders WHERE id=$1 AND mode=$2',[id,mode]))[0];return row?JSON.parse(row.data):null;}
export async function createOrder(q,b,key){
 if(typeof key!=='string'||!/^[-A-Za-z0-9_]{8,100}$/.test(key))bad(400,'Sertakan Idempotency-Key sepanjang 8–100 karakter.');
 if(!['gopay','shopee'].includes(b.channel)||!Number.isSafeInteger(b.amount)||b.amount<1000||b.amount>9999000||typeof b.reference!=='string'||!b.reference.trim()||b.reference.length>100)bad(400,'Periksa referensi, kanal, dan nominal (Rp1.000–Rp9.999.000).');
 const id=createHmac('sha256',process.env.DATA_KEY).update(mode+':'+key).digest('hex').slice(0,40);
 const prev=await getOrder(q,id);
 if(prev){if(prev.reference!==b.reference.trim()||prev.channel!==b.channel||prev.baseAmount!==b.amount)bad(409,'Idempotency-Key sudah dipakai dengan data berbeda.');return publicOrder(prev);}
 const scope=mode+':'+b.channel;const now=Date.now(),expires=now+900000;
 const used=new Set((await q("SELECT total FROM lp_orders WHERE channel=$1 AND total BETWEEN $2 AND $3 AND (status='pending' OR expires>$4)",[scope,b.amount+1,b.amount+999,now-86400000])).map(r=>r.total));
 let total=b.amount+1;while(used.has(total))total++;if(total>b.amount+999)bad(409,'Nominal sedang penuh.');
 const p={id,channel:b.channel,reference:b.reference.trim(),baseAmount:b.amount,uniqueAmount:total,uniqueOffset:total-b.amount,createdAt:now,expiresAt:expires,status:'pending'};
 if(mode==='live'){
   const cfg=await channel(q,b.channel);if(!cfg)bad(409,'Hubungkan kanal pembayaran terlebih dahulu.');
   const {staticToDynamicQris}=await import('merchantid');p.qrString=staticToDynamicQris(cfg.staticQris,total);
   p.scope=b.channel==='gopay'?{provider:'gopay',merchantId:cfg.merchantId}:{provider:'shopee',accountId:cfg.merchantId,merchantId:cfg.storeId};
 }
 await q('INSERT INTO lp_orders(id,mode,channel,total,status,created,expires,data) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',[id,mode,scope,total,'pending',now,expires,JSON.stringify(p)]);
 await enqueue(q,'payment.created',publicOrder(p));return publicOrder(p);
}
async function change(q,p,status,tx=null){
 const current=await getOrder(q,p.id);if(current?.status!=='pending')return;
 current.status=status;await q('UPDATE lp_orders SET status=$1,tx=$2,data=$3 WHERE id=$4',[status,tx,JSON.stringify(current),p.id]);await enqueue(q,'payment.'+status,publicOrder(current));
}
export async function simulate(q,id){if(mode!=='sandbox')bad(403,'Hanya untuk sandbox.');const p=await getOrder(q,id);if(!p)bad(404,'Tagihan tidak ditemukan.');await change(q,p,Date.now()>=p.expiresAt?'expired':'paid');}
export async function reconcile(q,name){
 const scope=mode+':'+name;
 const pending=(await q("SELECT data FROM lp_orders WHERE channel=$1 AND status='pending'",[scope])).map(r=>JSON.parse(r.data));if(!pending.length)return;
 if(mode==='sandbox'){for(const p of pending)if(Date.now()>=p.expiresAt)await change(q,p,'expired');return;}
 const stamp='checked:'+scope;if(Date.now()-Number(await setting(q,stamp)||0)<12000)return;
 const cfg=await channel(q,name);if(!cfg)bad(409,'Kanal belum terhubung.');
 const store={get:id=>getOrder(q,id),listActive:()=>pending,update:async p=>{
    const tx=p.transaction;
    if(p.status==='paid'&&(!tx?.id||!tx.status?.trim()||!Number.isFinite(Date.parse(tx.transactionTime))))bad(502,'Transaksi memerlukan verifikasi.');
    await change(q,p,p.status,tx?.id||null);
 }};
 const persist=async session=>save(q,'channel:'+name,seal({...cfg,session}));
 const {GopayProvider,ShopeeProvider}=await import('merchantid');const Provider=name==='gopay'?GopayProvider:ShopeeProvider;
 const provider=new Provider({...cfg,store,onTokenRefreshed:persist,onSessionUpdated:persist,requestTimeoutMs:6500});
 let error;const service=provider.payments();service.on('error',e=>{error=e;});await service.tick();if(error)bad(503,'Feed merchant belum dapat diperiksa.');await save(q,stamp,String(Date.now()));
}

