const $=id=>document.getElementById(id);
const rp=n=>'Rp'+Number(n).toLocaleString('id-ID');
let timer;
async function refresh(){
 try{const r=await fetch('/api/checkout?id='+encodeURIComponent(new URLSearchParams(location.search).get('id')||''));const p=await r.json();if(!r.ok)throw Error(p.error);
 $('ref').textContent=p.reference;$('total').textContent=rp(p.total);$('detail').textContent='Nominal '+rp(p.amount)+' + kode unik '+rp(p.total-p.amount);
 $('status').textContent=({pending:'Menunggu pembayaran',paid:'Pembayaran lunas',expired:'Tagihan kedaluwarsa'})[p.status];
 $('qr').hidden=!p.qr;if(p.qr)$('qr').src=p.qr;
 $('expires').textContent='Batas bayar '+new Date(p.expires_at).toLocaleString('id-ID');
 $('msg').textContent=p.mode==='sandbox'?'Sandbox · Simulasi tanpa transfer uang.':p.qr?'Pindai QRIS dan bayar sesuai total.':'';
 if(p.status!=='pending'){clearInterval(timer);$('check').hidden=true;}
 }catch(e){$('msg').textContent=e.message;$('qr').hidden=true;}
}
$('check').onclick=refresh;timer=setInterval(()=>{if(!document.hidden)refresh();},15000);refresh();
