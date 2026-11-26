import {pythonLogin} from './python-login.js';
import {randomUUID} from 'node:crypto';
import {bad,seal,unseal,setting,save} from './db.js';
export async function channel(q,name){const raw=await setting(q,'channel:'+name);return raw?unseal(raw):null;}
export async function loginStep(q,b){
 const name=b.channel;if(!['gopay','shopee'].includes(name))bad(400,'Pilih kanal pembayaran.');
 const {GopayProvider,ShopeeProvider,isValidQrisChecksum}=await import('merchantid');
 const key='challenge:'+name, raw=await setting(q,key), old=raw?unseal(raw):null;
 const state=old?.expires>Date.now()?old:null;
 const python=name==='shopee' && (b.step==='phone'?process.env.SHOPEE_LOGIN_DRIVER==='python':state?.python===true);
 const put=async data=>save(q,key,seal({...data,python,expires:Date.now()+300000}));
 if(b.step==='phone'){
   if(state && Date.now()-state.sent<60000)bad(429,'Tunggu satu menit sebelum meminta OTP lagi.');
   if(!/^(?:\+?62|0)8\d{7,12}$/.test(b.phone||''))bad(400,'Masukkan nomor HP Indonesia.');
   const phone=b.phone.replace(/^0/,'62').replace(/^\+/,'');const deviceId=randomUUID();
   let delivery='unknown';
   // MerchantId 0.1.1 exposes these two outcomes only through its logger.
   const logger={debug(){},warn(){},error(){},info(message){
     if(message==='shopee otp: send accepted with delivery seed')delivery='acknowledged';
     if(message==='shopee otp: send accepted but no delivery seed returned')delivery='unconfirmed';
   }};
   const provider=name==='gopay'?new GopayProvider({deviceId}):new ShopeeProvider({logger});
   const options=b.password?{password:b.password}:{};
   if(name==='shopee' && b.otpMethod && b.otpMethod!=='auto'){
     if(!['whatsapp','sms'].includes(b.otpMethod))bad(400,'Pilih metode OTP yang tersedia.');
     options.channel=b.otpMethod==='whatsapp'?3:1;
   }
   let challenge;
   try {challenge=python?await pythonLogin('phone',{phone,...options}):name==='gopay'?await provider.requestOtp(phone):await provider.requestOtp(phone,options);}
   catch(e){
     if(name==='shopee' && e.message==='Requested Shopee OTP channel is unavailable')bad(409,'Shopee tidak menawarkan metode tersebut untuk akun ini. Pilih Otomatis atau metode lain.');
     throw e;
   }
   await put({phase:'otp',phone,deviceId,challenge:name==='gopay'?{otpToken:challenge.otpToken||''}:challenge,sent:Date.now(),tries:0});
   const method=name==='shopee'?({1:'SMS',3:'WhatsApp',9:'Tautan WhatsApp'}[challenge.channel]||'Metode lain dari Shopee'):undefined;
   return {step:'otp',delivery,method,lastDigits:phone.slice(-4)};
 }
 if(!state||state.phase!==b.step)bad(409,'Langkah login kedaluwarsa. Mulai lagi.');
 if(b.step==='otp'){
   if(!/^\d{4,8}$/.test(b.otp||''))bad(400,'Periksa kode OTP.');
   if(state.tries>=5)bad(429,'Minta kode OTP baru.');
   state.tries++;await save(q,key,seal(state));
   let session,verification,choices;
   try{
    if(name==='gopay'){
     const provider=new GopayProvider({deviceId:state.deviceId});
     await provider.verifyOtp({otp:b.otp,otpToken:state.challenge.otpToken,phoneNumber:state.phone.replace(/^62/,'')});
     session=provider.exportSession();choices=(await provider.listMerchants()).map(m=>({id:m.id,name:m.merchantName,qris:m.qrString}));
    }else{
     verification=python?await pythonLogin('otp',{challenge:state.challenge,otp:b.otp}):await new ShopeeProvider().verifyOtp({challenge:state.challenge,otp:b.otp});
     choices=verification.merchants.filter(m=>python?(m.is_active&&!m.is_banned):(m.isActive&&!m.isBanned)).map(m=>({id:m.id,name:m.name}));
    }
   }catch{return {loginError:'Verifikasi provider gagal. Periksa OTP atau mulai ulang.'};}
   if(!choices.length)bad(409,'Akun tidak memiliki merchant aktif.');
   await put({phase:'merchant',session,verification,choices,sent:state.sent});
   return {step:'merchant',choices:choices.map(({id,name})=>({id,name}))};
 }
 const selected=state.choices?.find(x=>x.id===b.selection);if(!selected)bad(400,'Pilihan merchant atau toko salah.');
 let config;
 if(b.step==='merchant'&&name==='shopee'){
   const provider=new ShopeeProvider();const session=python?await pythonLogin('merchant',{verification:state.verification,id:selected.id}):await provider.completeLogin({verification:state.verification,merchantId:selected.id});
   const choices=(python?session.stores:await provider.listStores()).map(s=>({id:s.id,name:s.name}));
   if(!choices.length && session.storeId)choices.push({id:session.storeId,name:session.storeId});
   if(!choices.length)bad(409,'Tidak ada store untuk merchant ini.');
   await put({phase:'store',merchant:selected,choices,session:python?session:provider.exportSession(),sent:state.sent});
   return {step:'store',choices};
 }
 if(name==='gopay'){
   const p=new GopayProvider({session:state.session,merchantId:selected.id});
   config={merchantId:selected.id,label:selected.name,session:state.session,staticQris:b.qris||selected.qris||await p.resolveStaticQris()};
 }else{
   const p=new ShopeeProvider({session:state.session});const session=await p.selectStore(selected.id);
   config={merchantId:state.merchant.id,storeId:selected.id,label:state.merchant.name+' / '+selected.name,session,staticQris:b.qris,staticQrisScope:{merchantId:state.merchant.id,storeId:selected.id}};
 }
 if(!config.staticQris||!isValidQrisChecksum(config.staticQris))bad(400,'Masukkan payload QRIS statis yang valid untuk outlet ini.');
 const previous=await channel(q,name);
 if(previous && (previous.merchantId!==config.merchantId||previous.storeId!==config.storeId) && (await q("SELECT id FROM lp_orders WHERE channel=$1 AND status='pending' LIMIT 1",['live:'+name])).length)bad(409,'Selesaikan tagihan aktif sebelum mengganti outlet.');
 await save(q,'channel:'+name,seal(config));await q('DELETE FROM lp_settings WHERE id=$1',[key]);return {step:'done'};
}
