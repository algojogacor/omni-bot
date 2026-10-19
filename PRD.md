# Omni-Bot: PRD Revisi

Disusun 19 Oktober 2026 setelah sesi review kritis terhadap PRD awal. Dokumen ini menggantikan PRD sebelumnya.

## 1. Ringkasan produk

Omni-Bot adalah bot Telegram pribadi (satu pengguna, tanpa slash command) untuk tiga hal: mencatat pemasukan, pengeluaran, dan perpindahan uang per dompet lewat kalimat kasual; menjawab rekap dan saldo; serta meringkas log grup panjang menjadi TL;DR, daftar tugas, dan jadwal yang bisa dimasukkan ke Google Calendar. Prinsip utamanya: bot boleh menafsirkan, tapi tidak boleh menyimpan apa pun tanpa persetujuan Arya.

## 2. Keputusan final

| Area | Keputusan |
| --- | --- |
| Hosting dan runtime | Koyeb free tier dengan Bun. Dites sejak awal; kalau CPU melonjak di 0.1 vCPU, pindah ke Node. |
| Penerimaan pesan | Long polling, ditambah pinger eksternal tiap 5 menit ke /health. |
| Database | Turso (libSQL) + Drizzle, database khusus bot ini. |
| LLM | Groq (rotator multi-key, model utama qwen/qwen3.8-27b, fallback openai/gpt-oss-120b) + Ollama Cloud (gpt-oss:120b-cloud) sebagai fallback tambahan sebelum mode manual. |
| Konfirmasi | Semua transaksi dan event berupa draf yang harus disetujui dulu. |
| Koreksi | Balas lewat chat biasa, ditambah tombol edit per item. |
| Dompet | Tunai, GoPay, Bank Mandiri. Saldo dilacak per dompet. |
| Tipe catatan | Pengeluaran, Pemasukan, Transfer antar dompet. Tidak ada split bill. |
| Waktu | Tanggal mundur didukung. LLM diberi hari, tanggal, dan jam WIB saat ini. |
| Kategori | Daftar tetap, boleh disesuaikan saat build. |
| Input | Teks saja. Voice note ditunda, foto struk dilewati. |
| Log panjang | Tanpa chunking. Ukuran diperkirakan dulu, dan kalau terlalu besar bot membalas dengan pesan jelas. |
| Debounce | Semua pesan ditunggu 1,5 detik sebelum diproses. |
| Log grup | TL;DR, semua tugas per orang dengan tugas Arya disorot di atas, jadwal menjadi draf event. Teks mentah tidak disimpan. |
| Kalender | Service Account langsung ke kalender utama Arya (aryarizkyardhipratama@gmail.com). Dilarang fallback diam-diam ke kalender lain. Mendukung sinkronisasi event, hapus event, dan tanya agenda live. |
| Saat kuota LLM habis | Mode manual: parser deterministik regex dan kamus angka kata bahasa Indonesia tanpa LLM. |
| Operasional | Notifikasi error ke Telegram Arya dan perintah export CSV. |
| Proaktif & Manual | Ringkasan mingguan otomatis Minggu malam (20.00 WIB) dengan anti-dobel berbasis database, plus pemicu manual kapan saja tanpa memengaruhi pencatatan otomatis. |

## 3. Perilaku produk

### 3.1 Akses

Bot hanya merespons satu akun Telegram (`ALLOWED_TELEGRAM_USER_ID`). Pesan dari akun lain diabaikan sepenuhnya. Tidak ada slash command yang wajib dihafal; teks apa pun diterima dan bot menentukan sendiri maksudnya.

### 3.2 Alur draf dan konfirmasi

- Setiap transaksi dan event yang terdeteksi ditampilkan sebagai draf dengan tombol Simpan dan Batal. Tidak ada yang masuk database atau Google Calendar sebelum Arya menyetujui.
- Koreksi bisa lewat chat biasa ("yang parkir harusnya 5rb, hapus kopinya"), lalu draf direvisi dan ditampilkan lagi. Setiap item juga punya tombol edit sebagai jalur aman kalau tafsiran terus meleset.
- Draf yang menunggu disimpan di database, bukan di memori, supaya aman kalau instance restart.
- Kalau informasi penting kurang, bot bertanya dengan tombol pilihan, bukan menebak.

### 3.3 Dompet, saldo, dan tipe catatan

- Tiga dompet: Tunai, GoPay, Bank Mandiri. Setiap catatan wajib terhubung ke dompet.
- Kalau dompet tidak disebut ("aku makan 20k tadi pagi"), bot bertanya "pakai uang dari mana?" dengan tombol Tunai, GoPay, Mandiri.
- Tiga tipe catatan: Pengeluaran, Pemasukan, dan Transfer. Transfer memindahkan saldo antar dompet (tarik tunai, top up GoPay) dan tidak dihitung sebagai pemasukan atau pengeluaran. Transfer harus punya dompet asal dan tujuan yang jelas; kalau salah satunya ambigu, bot bertanya.
- Saldo awal tiap dompet diatur lewat chat ("saldo awal tunai 100rb"). Pemasukan bisa ditambahkan kapan saja ("dapat 50k dari mama, masuk ke bank").
- Saldo dan semua total dihitung oleh kode, bukan oleh LLM. Uang disimpan sebagai bilangan bulat Rupiah.
- Kategori pengeluaran memakai daftar tetap (awalnya: Makanan, Transport, Kuliah/Organisasi, Hiburan, Tagihan, Lainnya).

### 3.4 Waktu dan rekap

- Semua perhitungan hari, minggu, dan bulan memakai zona waktu Asia/Jakarta (WIB).
- LLM selalu diberi hari, tanggal, dan jam saat ini, plus tabel tanggal 14 hari ke depan sebagai acuan untuk ungkapan seperti "lusa" atau "Jumat depan".
- Transaksi dengan waktu lain ("tadi pagi", "kemarin") dicatat di tanggal yang benar, dan tanggal itu ditampilkan jelas di draf konfirmasi.
- Setiap jawaban rekap menyebut rentang tanggal yang dipakai (misalnya "Senin 12 sampai Minggu 18 Okt"), supaya kesalahan tafsir langsung terlihat.
- Pertanyaan rekap bisa mencakup periode, kategori, kata kunci, dan saldo per dompet.

### 3.5 Log grup

- Input bisa berupa paste atau forward ratusan baris. Telegram memecahnya menjadi beberapa pesan, jadi semua pesan ditunggu 1,5 detik sejak pesan terakhir lalu digabung.
- Output: TL;DR pengumuman penting, daftar tugas semua orang per penanggung jawab dengan tugas Arya disorot di paling atas, dan jadwal atau tenggat yang menjadi draf event.
- Transaksi yang terdeteksi dalam log grup (misalnya uang kas) tetap hanya berupa draf yang harus dikonfirmasi.
- Teks mentah log grup tidak disimpan. Yang disimpan hanya hasil ekstraksi yang disetujui.
- Tidak ada chunking di versi awal. Sebelum dikirim ke LLM, ukuran diperkirakan; kalau melebihi batas, bot membalas jelas (misalnya "log terlalu panjang, kirim per bagian") dan tidak gagal diam-diam.

### 3.6 Google Calendar

- Autentikasi lewat Service Account ke kalender utama Arya (`aryarizkyardhipratama@gmail.com`). Kalender utama harus dibagikan ke email service account dengan izin "Make changes and see all event details".
- Dilarang keras melakukan fallback diam-diam ke kalender lain. Jika kalender utama tidak dapat diakses, bot harus gagal dengan pesan yang jelas dan mengirim notifikasi error ke Telegram Arya.
- Draf event bisa diedit (chat atau tombol) sebelum disinkronkan. Kalau durasi tidak disebut, asumsikan 1 jam (30 menit untuk tenggat tugas).
- Setelah ter-sync, event bisa dihapus lewat tombol, dan bot menghapusnya juga dari Google Calendar.
- Fitur baca agenda: Arya bisa menanyakan jadwal terdekat atau agenda periode tertentu lewat chat santai ("apa jadwal terdekat saya?", "senin depan ada kegiatan apa?"), dan bot membaca agenda langsung dari Google Calendar.

### 3.7 Ringkasan mingguan

- Bot mengirim ringkasan otomatis sekali seminggu (Minggu malam sekitar pukul 20.00 WIB): saldo per dompet, total pemasukan dan pengeluaran minggu itu, dan kategori terbesar.
- Pengiriman harus aman terhadap restart atau tidur instance: catat minggu mana yang sudah terkirim di tabel `weekly_reports`, dan kejar saat instance hidup lagi tanpa mengirim dobel.
- Tersedia pemicu manual lewat perintah santai ("ringkasan mingguan", "preview mingguan", "/rekap_mingguan") untuk melihat pratinjau ringkasan mingguan kapan saja tanpa mempengaruhi pencatatan anti-dobel otomatis.

### 3.8 Saat LLM tidak tersedia (Rantai Failover)

- Rantai failover inferensi AI:
  1. **Groq Primary**: `qwen/qwen3.8-27b` (dengan rotasi multi-key round-robin; model terbaik dan sangat akurat memahami slang bahasa Indonesia serta native tool calling).
  2. **Groq Fallback**: `openai/gpt-oss-120b` (saat semua key Groq pada model primary terkena cooldown).
  3. **Ollama Cloud**: `gpt-oss:120b-cloud` (fallback tingkat dua jika seluruh kuota Groq habis).
  4. **Mode Manual Deterministik**: Jika seluruh provider AI tidak tersedia, parser lokal regex & kamus bilangan kata bahasa Indonesia tetap memproses transaksi, transfer, cek saldo, dan rekap tanpa error. Log grup yang butuh penalaran AI ditolak sementara dengan pesan yang jelas.

### 3.9 Operasional

- Error penting (key habis, database gagal, sinkronisasi kalender gagal) dikirim sebagai notifikasi ke Telegram Arya sendiri.
- Perintah export CSV untuk mencadangkan data keuangan.
- Endpoint /health ringan untuk pinger eksternal tiap 5 menit, mengembalikan status dan penggunaan memori.

## 4. Arah teknis

- Bun + TypeScript, grammY untuk Telegram, server HTTP bawaan Bun untuk /health.
- Turso (libSQL) + Drizzle. Tanpa engine binary, jadi lebih ringan dan cocok untuk Bun.
- Groq dengan model utama `qwen/qwen3.8-27b` dan model fallback `openai/gpt-oss-120b`. Rotator menjalankan round-robin antar key, menaruh key yang kena limit dalam masa tunggu, dan pindah model kalau semua key terkena limit.
- Ollama Cloud (`gpt-oss:120b-cloud`) sebagai lapis cadangan kedua jika seluruh kuota Groq habis, sebelum masuk ke parser deterministik offline.
- Google Calendar terhubung langsung ke kalender utama Arya tanpa fallback diam-diam, dilengkapi fitur pembuatan event, pembatalan/penghapusan, dan pencarian agenda kegiatan mendatang.
- Pemanggilan LLM memakai tool calling dengan tool yang terpisah dan jelas untuk: mencatat transaksi (pengeluaran dan pemasukan), transfer antar dompet, query rekap, draf event, dan query jadwal agenda.
- Telegram bisa mengirim ulang update, jadi update yang sudah diproses harus dikenali (dedupe), dan event kalender tidak boleh tercatat dobel.
- Balasan harus aman diparse Telegram (hindari Markdown mentah dari LLM yang sering merusak format) dan dipecah kalau melebihi batas panjang pesan.
- Tangani tool call yang malformed dari model dengan retry, bukan error mentah ke pengguna.
- Target memori rendah itu preferensi, bukan syarat mati. Prioritaskan kejelasan dan keandalan.

## 5. Hal yang perlu dicek sebelum dan saat build

1. **Bun di Koyeb 0.1 vCPU.** Pengalaman di proyek lain menunjukkan lonjakan CPU; deploy kerangka awal lebih dulu dan ukur. Kalau bermasalah, pindah ke Node.
2. **Batas Groq free tier.** Menurut hasil pencarian saya, model 70b punya sekitar 12 ribu token per menit dan 100 ribu token per hari per organisasi. Angka ini bisa berubah; cek halaman limits di console Groq. Limit per request berlaku di key mana pun, jadi rotator tidak menolong untuk log yang terlalu besar.
3. **Risiko multi-akun Groq.** Memakai banyak akun untuk menambah kuota adalah risiko yang ditanggung sendiri; akun bisa saja diblokir. Pastikan bot tetap berjalan (mode manual dan fallback) kalau satu key mati mendadak.
4. **Kebijakan tidur Koyeb free tier.** Verifikasi aturan terbarunya, karena long polling bergantung pada instance yang tetap hidup.
5. **Share Google Calendar** ke email service account, kalau tidak, semua sinkronisasi gagal.
6. **Privasi.** Log grup berisi data orang lain yang dikirim ke penyedia LLM pihak ketiga. Wajar untuk bot pribadi, tapi perlu disadari.