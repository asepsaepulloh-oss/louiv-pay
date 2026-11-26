const $=id=>document.getElementById(id);
const tabs={overview:'Ringkasan',payments:'Transaksi',channels:'Kanal pembayaran',keys:'API keys',hooks:'Webhook',docs:'Dokumentasi API'};
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const rp=n=>'Rp'+Number(n).toLocaleString('id-ID');
const labels={pending:'Menunggu',paid:'Lunas',expired:'Kedaluwarsa',queued:'Antrean',sending:'Mengirim',delivered:'Terkirim',failed:'Gagal'};
const badge=s=>'<span class="badge '+esc(s)+'">'+esc(labels[s]||s)+'</span>';
let tab='overview',state,noticeTimer;
function notify(s){$('notice').hidden=false;$('notice').textContent=s;clearTimeout(noticeTimer);noticeTimer=setTimeout(()=>$('notice').hidden=true,5000);}
async function api(path,body,headers={}){
 const r=await fetch('/api/'+path,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Louiv-Client':'dashboard',...headers},body:JSON.stringify(body)});
 const result=await r.json();if(!r.ok){if(r.status===401 && path!=='login'){showLogin();}throw Error(result.error||'Permintaan gagal.');}return result;
}
function showLogin(){$('shell').hidden=true;$('login').hidden=false;if($('dialog').open)$('dialog').close();}
async function load(){state=await api('dashboard');$('shell').hidden=false;$('login').hidden=true;render();}
function button(action,label,id=''){return '<button class="light" data-action="'+action+'" data-id="'+esc(id)+'">'+esc(label)+'</button>';}
const box=(title,body)=>'<section class="box"><div class="bar"><h2>'+title+'</h2></div>'+body+'</section>';
function rows(items){return items.join('')||'<p class="empty">Belum ada data.</p>';}
function table(items){
 if(!items.length)return '<p class="empty">Belum ada transaksi yang cocok.</p>';
 return '<div class="scroll"><table><thead><tr><th>Referensi</th><th>Kanal</th><th>Total</th><th>Status</th><th>Checkout</th></tr></thead><tbody>'+items.map(p=>'<tr><td>'+esc(p.reference)+'<br><small>'+esc(new Date(p.created_at).toLocaleString('id-ID'))+'</small></td><td>'+esc(p.channel)+'</td><td>'+rp(p.total)+'</td><td>'+badge(p.status)+'</td><td><a href="/checkout.html?id='+encodeURIComponent(p.id)+'" target="_blank" rel="noopener">Buka</a> '+(state.mode==='sandbox'&&p.status==='pending'?button('simulate','Simulasikan lunas',p.id):'')+'</td></tr>').join('')+'</tbody></table></div>';
}
function docs(){return box('Autentikasi','<p>Kirim API key dari server aplikasi dengan header <code>Authorization: Bearer API_KEY</code>. Gunakan key sesuai mode dashboard.</p>')+box('Buat pembayaran','<pre>POST /api/v1/payments\nAuthorization: Bearer API_KEY\nContent-Type: application/json\nIdempotency-Key: pesanan-1001\n\n{"reference":"Pesanan 1001","amount":25000,"channel":"gopay"}</pre><p>Gunakan kembali Idempotency-Key yang sama saat mencoba ulang. Arahkan pembeli ke <code>checkout_url</code> dari respons. Pilihan kanal adalah gopay dan shopee.</p>')+box('Periksa status','<pre>GET /api/v1/payments/{id}\nAuthorization: Bearer API_KEY</pre><p>Status transaksi adalah pending, paid, atau expired. Nilai total sudah mencakup kode unik.</p>')+box('Verifikasi webhook','<p>Gunakan body mentah dan header Louiv-Timestamp. Hitung HMAC-SHA256 dengan signing secret atas <code>timestamp + "." + rawBody</code>. Cocokkan <code>v1=</code> diikuti digest hex dengan Louiv-Signature. Tolak timestamp lebih dari lima menit dan deduplikasi ID event. Contoh Node.js tersedia di README.</p>');}
function render(){
 $('title').textContent=tabs[tab];$('mode').textContent=state.mode==='live'?'Live':'Sandbox';
 document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('active',b.dataset.tab===tab));
 let html='';
 if(tab==='overview'){const s=state.stats;html='<div class="grid">'+[['Pembayaran diterima',rp(s.revenue)],['Total transaksi',s.orders],['Menunggu pembayaran',s.pending]].map(([l,v])=>'<div class="card"><p>'+l+'</p><strong>'+v+'</strong></div>').join('')+'</div>'+box('Transaksi terbaru',table(state.orders.slice(0,8)));}
 if(tab==='payments')html=box('Riwayat transaksi','<div class="bar"><input id="search" aria-label="Cari transaksi" placeholder="Cari referensi atau ID"><select id="filter" aria-label="Status"><option value="">Semua status</option><option value="pending">Menunggu</option><option value="paid">Lunas</option><option value="expired">Kedaluwarsa</option></select></div><div id="items">'+table(state.orders)+'</div>');
 if(tab==='channels')html=box('Akun merchant',Object.entries({gopay:'GoPay Merchant',shopee:'ShopeePay Merchant'}).map(([id,label])=>'<div class="row"><div><strong>'+label+'</strong><small>'+esc(state.channels[id]||'Belum terhubung')+'</small></div>'+button('connect',state.channels[id]?'Hubungkan ulang':'Hubungkan',id)+'</div>').join(''))+(state.mode==='sandbox'?'<p>Sandbox menggunakan transaksi simulasi. Login provider tersedia saat PAY_MODE=live.</p>':'');
 if(tab==='keys')html=box('Kunci integrasi',button('key','Buat API key')+rows(state.keys.map(k=>'<div class="row"><div><strong>'+esc(k.name)+'</strong><small>'+esc(k.prefix)+'…</small></div>'+(k.revoked?'Dicabut':button('revoke','Cabut',k.id))+'</div>')));
 if(tab==='hooks')html=box('Endpoint webhook','<div class="row"><div><strong>'+esc(state.hook.url||'Belum dikonfigurasi')+'</strong><small>payment.created · payment.paid · payment.expired</small></div>'+button('hook','Atur endpoint')+(state.hook.url?button('test','Kirim event uji'):'')+'</div>')+box('Riwayat pengiriman',rows(state.events.map(e=>'<div class="row"><div><strong>'+esc(e.type)+'</strong><small>'+esc(e.id)+' · '+e.attempts+' percobaan'+(e.code?' · HTTP '+e.code:'')+'</small></div>'+badge(e.state)+(['failed','queued'].includes(e.state)?button('retry','Coba lagi',e.id):'')+'</div>')));
 if(tab==='docs')html=docs();
 $('content').innerHTML=html;
 if(tab==='payments'){const filter=()=>{$('items').innerHTML=table(state.orders.filter(p=>(p.reference+' '+p.id).toLowerCase().includes($('search').value.toLowerCase())&&(!$('filter').value||p.status===$('filter').value)));};$('search').oninput=filter;$('filter').onchange=filter;}
}
function modal(title,html){$('panel').innerHTML='<h2>'+esc(title)+'</h2>'+html;if(!$('dialog').open)$('dialog').showModal();}
function form(title,fields,submit,fn){
 modal(title,'<form>'+fields+'<button>'+esc(submit)+'</button><p class="error" role="alert"></p></form>');
 const f=$('panel').querySelector('form');f.onsubmit=async e=>{e.preventDefault();const btn=f.querySelector('button');btn.disabled=true;try{await fn(Object.fromEntries(new FormData(f)));}catch(e){f.querySelector('.error').textContent=e.message;}finally{btn.disabled=false;}};
}
const input=(label,name,type='text',extra='required')=>'<label>'+label+'<input name="'+name+'" type="'+type+'" '+extra+'></label>';
function secret(title,value){modal(title,'<p>Salin dan simpan sekarang. Nilai lengkap hanya ditampilkan sekali.</p><pre>'+esc(value)+'</pre>'+button('copy','Salin'));}
async function done(){if($('dialog').open)$('dialog').close();await load();}
function connect(name,step='phone',choices=[],delivery='unknown'){
 if(state.mode==='sandbox'){notify('Untuk login merchant asli, ubah PAY_MODE menjadi live di server.');return;}
 let fields;
 if(step==='phone')fields=input('Nomor HP akun merchant','phone','tel')+(name==='shopee'?input('Password Shopee jika akun memerlukannya','password','password','autocomplete="off"'):'');
 if(step==='otp'){
   const message=delivery==='unconfirmed'?'Shopee menerima permintaan tanpa memberikan tanda pengiriman. Jika kode belum tiba, periksa login lewat aplikasi merchant resmi.':delivery==='acknowledged'?'Shopee mengakui permintaan pengiriman. Masukkan kode jika sudah tiba.':'Permintaan kode sudah diproses. Masukkan kode jika sudah tiba.';
   fields='<p>'+message+'</p>'+input('Kode OTP','otp','text','required inputmode="numeric" autocomplete="one-time-code"');
 }
 if(['merchant','store'].includes(step))fields='<label>'+ (step==='store'?'Toko':'Merchant')+'<select name="selection">'+choices.map(x=>'<option value="'+esc(x.id)+'">'+esc(x.name||x.id)+'</option>').join('')+'</select></label>'+((name==='shopee'&&step==='store')||(name==='gopay'&&step==='merchant')?'<label>Payload QRIS statis '+(name==='gopay'?'(opsional jika tersedia di outlet)':'untuk toko ini')+'<textarea name="qris" '+(name==='shopee'?'required':'')+'></textarea></label>':'');
 form('Hubungkan '+(name==='gopay'?'GoPay Merchant':'ShopeePay Merchant'),fields,step==='phone'?'Kirim OTP':'Lanjutkan',async b=>{const s=await api('channels/login',{...b,channel:name,step});if(s.step==='done'){await done();notify('Akun merchant terhubung.');}else connect(name,s.step,s.choices,s.delivery);});
}
async function action(a,id){
 if(a==='new'){const key=crypto.randomUUID();form('Buat pembayaran',input('Referensi pesanan','reference','text','required maxlength="100"')+input('Nominal (Rp)','amount','number','required min="1000" max="9999000"')+'<label>Kanal<select name="channel"><option value="gopay">GoPay Merchant</option><option value="shopee">ShopeePay Merchant</option></select></label>','Buat tautan',async b=>{const p=await api('v1/payments',{...b,amount:Number(b.amount)},{'Idempotency-Key':key});await load();modal('Tautan pembayaran','<p>'+esc(p.reference)+' · '+rp(p.total)+'</p><pre>'+esc(new URL(p.checkout_url,location.origin).href)+'</pre>'+button('copy','Salin tautan'));});}
 if(a==='key')form('Buat API key',input('Nama aplikasi','name','text','required maxlength="60"'),'Buat kunci',async b=>{const s=await api('keys',b);await load();secret('API key baru',s.secret);});
 if(a==='revoke')form('Cabut API key','<p>Aplikasi yang memakai kunci ini akan kehilangan akses.</p>','Cabut kunci',async()=>{await api('keys/revoke',{id});await done();});
 if(a==='hook')form('Atur webhook',input('URL HTTPS penerima','url','url','value="'+esc(state.hook.url)+'"')+'<p>Menyimpan URL menghasilkan secret baru. Kosongkan untuk menonaktifkan pengiriman event baru.</p>','Simpan endpoint',async b=>{const s=await api('hooks',b);await load();if(s.secret)secret('Signing secret',s.secret);else await done();});
 if(a==='test'||a==='retry'){await api(a==='test'?'hooks/test':'hooks/retry',{id});await load();notify('Riwayat pengiriman diperbarui.');}
 if(a==='simulate'){await api('simulate',{id});await load();}
 if(a==='connect')connect(id);
 if(a==='copy'){await navigator.clipboard.writeText($('panel').querySelector('pre').textContent);notify('Disalin.');}
}
$('loginForm').onsubmit=async e=>{e.preventDefault();try{await api('login',Object.fromEntries(new FormData(e.target)));e.target.reset();await load();}catch(e){notify(e.message);}};
$('close').onclick=()=>$('dialog').close();$('dialog').onclose=()=>$('panel').replaceChildren();
$('logout').onclick=async()=>{try{await api('logout',{});showLogin();}catch(e){notify(e.message);}};
$('new').onclick=()=>action('new');
document.addEventListener('click',e=>{const el=e.target.closest('button');if(el?.dataset.tab){tab=el.dataset.tab;render();load().catch(e=>notify(e.message));}if(el?.dataset.action)action(el.dataset.action,el.dataset.id).catch(e=>notify(e.message));});
load().catch(e=>{if(!e.message.includes('masuk'))notify(e.message);});
