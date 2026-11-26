# Louiv Pay

Dashboard gateway QRIS yang di-host sendiri untuk pemilik merchant. Satu instalasi memiliki satu workspace privat, satu akun GoPay Merchant dan satu akun ShopeePay Merchant yang dapat dipakai bersamaan. Integrasi upstream: https://github.com/alhifnywahid/merchantid. Metode yang tersedia adalah QRIS. Penyedia memproses dana di akun merchant masing-masing. Aplikasi ini tidak mengelola pencairan saldo.

## Coba langsung di Windows

Gunakan Node.js 22.13+ (atau Node 24 untuk sandbox lokal). Ekstrak ZIP lalu dari folder package.json jalankan:

    node server.js

Buka http://localhost:3000. Masuk dengan ADMIN_KEY dari file .local-secrets.json yang dibuat pada start pertama. Mode lokal hanya mendengarkan di 127.0.0.1. SQLite menyimpan tagihan, kunci dan event selama restart. Untuk membuktikan alur: buat API key, buat pembayaran, buka checkout, klik Simulasikan lunas pada dashboard, lalu periksa status checkout. Saat mode sandbox aktif, provider tidak menerima permintaan login atau transaksi. Jalankan npm test untuk tes integrasi sandbox tanpa layanan eksternal.

## Variabel hosting

| Variabel | Isi |
| --- | --- |
| PAY_MODE | sandbox atau live. Untuk dua mode sekaligus gunakan deployment terpisah dengan database dan secrets masing-masing. |
| DATABASE_URL | URL PostgreSQL, wajib di Vercel dan Railway. Gunakan database khusus dengan izin membuat tabel. |
| ADMIN_KEY | Kunci privat untuk masuk ke dashboard (minimal 32 karakter acak). |
| DATA_KEY | 64 digit hex acak. Mengenkripsi sesi provider, tantangan login, dan signing secret menggunakan AES-256-GCM. Pertahankan saat redeploy agar data lama bisa dibaca. |
| APP_URL | Origin HTTPS deployment, misalnya https://pay.toko.id, agar checkout_url berupa URL absolut. |
| WEBHOOK_HOSTS | Nama host HTTPS tujuan webhook yang Anda kendalikan, dipisah koma, misalnya api.toko.id. Port standar 443. |
| CRON_SECRET | Token acak untuk job rekonsiliasi dan pengiriman ulang. |

Buat nilai acak yang berbeda untuk setiap secret:

    node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

## Deploy ke Vercel

1. Impor proyek dari GitHub atau jalankan npx vercel dari folder ini. Preset Other, output directory public, build command kosong. Konfigurasi Node Function dan rewrite API tersedia di vercel.json.
2. Tambahkan environment variables pada project. Gunakan URL PostgreSQL publik/pooler yang dapat dijangkau Vercel. Bila memakai Postgres Railway, salin URL koneksi publik dari service database.
3. Jalankan npx vercel --prod atau redeploy dari dashboard. Atur APP_URL ke domain final dan redeploy setelah mengubah variabel.
4. Gunakan scheduler HTTPS dengan POST dan Authorization Bearer ke /api/jobs/run tiap menit. Scheduler yang hanya bisa GET tidak cocok dengan endpoint ini.

## Deploy ke Railway

1. Buat project, tambahkan PostgreSQL dan service aplikasi dari repo atau upload via Railway CLI (railway login, railway link, railway up).
2. Di Variables service aplikasi, referensikan DATABASE_URL dari service PostgreSQL pada project/environment yang sama. Isi variabel lain dalam tabel di atas. Start command npm start tersedia di railway.json.
3. Generate Domain pada Networking, isi APP_URL dengan domain itu, lalu redeploy. Atur scheduler seperti pada Vercel.

## Hubungkan merchant di dashboard

1. Set PAY_MODE=live, isi variabel hosting lalu masuk menggunakan kunci dashboard. Untuk live lokal, isi .env berdasarkan .env.example dan jalankan npm install lalu node --env-file=.env server.js.
2. Buka **Kanal pembayaran**. Pilih **Hubungkan** pada GoPay Merchant atau ShopeePay Merchant, masukkan nomor akun sendiri dan minta OTP. Jika akun Shopee membutuhkan password, isi saat meminta OTP. OTP dan password tidak disimpan sebagai kolom atau dicetak ke log. Data tantangan sementara dan sesi provider disimpan terenkripsi di server.
3. Masukkan OTP, pilih merchant dari daftar akun. Pada GoPay, QRIS dapat diambil dari data merchant. Jika outlet yang diinginkan berbeda atau QRIS kosong, masukkan payload statis outlet yang tepat. Untuk Shopee, pilih store dan masukkan payload teks QRIS statis store itu (hasil baca QR dari aplikasi merchant).
4. Coba invoice nominal kecil dan cocokkan nama penerima serta nominal di aplikasi pembayaran. Status Lunas berasal dari feed provider. Integrasi privat MerchantId bisa berubah. Bila provider meminta CAPTCHA, menolak OTP, atau menahan pengiriman, ikuti proses resmi provider dan coba kembali. Sesi kedaluwarsa dapat dihubungkan ulang melalui menu yang sama.

## API pembayaran

Buat key di menu **API keys**. Nilai lengkap hanya ditampilkan sekali. Simpan pada backend toko. Kunci dapat dicabut dari dashboard. Buat pembayaran dengan POST /api/v1/payments, Content-Type application/json, Authorization Bearer <API_KEY> dan Idempotency-Key (8–100 huruf, angka, strip, garis bawah). Kirim JSON:

    {"reference":"Pesanan 1001","amount":25000,"channel":"shopee"}

channel juga dapat bernilai gopay. Ulangi permintaan identik memakai key yang sama untuk menerima tagihan lama. Perbedaan data dengan key yang sama menghasilkan HTTP 409. Arahkan pelanggan ke checkout_url. Baca status dengan GET /api/v1/payments/{id} memakai API key. Contoh respons dengan nominal ilustratif:

    {"id":"...","reference":"Pesanan 1001","amount":25000,"total":25001,"status":"pending","channel":"shopee","created_at":"...","expires_at":"...","checkout_url":"https://pay.toko.id/checkout.html?id=..."}

Masa bayar 15 menit. Kode unik masuk dalam total. Tautan checkout memberi akses baca kepada pemegang tautan, tanpa hak pengelolaan merchant. Pada sandbox, aksi admin Simulasikan lunas memicu alur status dan webhook. Pada live, status berasal dari pemeriksaan feed. Pembayaran terlambat di luar jendela rekonsiliasi perlu dicocokkan manual dengan dashboard provider.

## Webhook

Masukkan hostname tujuan ke WEBHOOK_HOSTS, lalu simpan URL di dashboard. Salin signing secret yang tampil sekali. Klik Kirim event uji, lihat hasil HTTP, percobaan dan status. Event baru membawa id, type, mode, created_at dan data. Tipe event: payment.created, payment.paid, payment.expired, webhook.test. Endpoint harus memberi respons 2xx dalam 4 detik. Simpan perubahan bisnis sebelum mengembalikan 2xx. Pengiriman bersifat at-least-once. Deduplikasi id dengan unique constraint di database penerima. Jangan tandai pesanan lunas atas dasar event created.

Contoh verifikasi Node.js (rawBody adalah Buffer asli sebelum parser JSON):

    import {createHmac, timingSafeEqual} from 'node:crypto';
    function verify(headers, rawBody, secret) {
      const ts = headers['louiv-timestamp'];
      if (!/^\d+$/.test(ts || '') || Math.abs(Date.now()/1000 - Number(ts)) > 300) return false;
      const expected = 'v1=' + createHmac('sha256', secret).update(ts+'.').update(rawBody).digest('hex');
      const got = Buffer.from(headers['louiv-signature'] || '');
      return got.length === Buffer.byteLength(expected) && timingSafeEqual(got, Buffer.from(expected));
    }

Receiver harus menolak signature yang salah, memeriksa mode, lalu memproses event secara idempoten. Menyimpan pengaturan webhook lagi menerbitkan secret baru untuk event baru. Event lama tetap menggunakan tujuan dan secret saat event dibuat, termasuk saat retry. Signing secret lama perlu dipertahankan penerima selama antrean lama masih ada.

## Rekonsiliasi dan retry

Scheduler mengirim POST /api/jobs/run dengan Authorization: Bearer <CRON_SECRET>. Setiap panggilan memeriksa kedua kanal dan memproses hingga tiga event siap kirim. Antrean persisten memakai lease untuk menghindari klaim serentak. Gagal kirim dicoba ulang dengan jeda meningkat, maksimal enam percobaan otomatis. Klik Coba lagi untuk mengantrekan ulang. Periksa frekuensi scheduler terhadap jumlah event toko. Browser checkout juga memeriksa status setiap 15 detik. Tanpa scheduler, tagihan yang ditinggalkan dan retry webhook dapat tertunda.

## Catatan operasional

Dashboard menampilkan 200 transaksi terbaru, total ringkasan atas semua transaksi, dan 50 event pengiriman. Gunakan HTTPS dan simpan backup PostgreSQL serta DATA_KEY secara privat. Jangan aktifkan log body request pada hosting. Kelola sesi dashboard melalui cookie HttpOnly berumur delapan jam. Satu gateway harus menjadi satu-satunya penerbit nominal unik untuk outlet yang terhubung. Untuk membuka pendaftaran merchant pihak ketiga dibutuhkan pengelolaan tenant, identitas, dan onboarding provider tersendiri.
"# louiv-pay" 
