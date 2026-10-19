# Omni-Bot Worklog

## Status Ringkasan
- **Tanggal Mulai**: 19 Oktober 2026
- **Status Saat Ini**: Inisialisasi proyek, pembuatan rencana implementasi, dan persiapan kerangka skeleton Bun untuk pengujian di Koyeb 0.1 vCPU.

## Keputusan Arsitektur & Aturan Keras
1. **Keamanan & Otorisasi**:
   - Hanya user ID Telegram `ALLOWED_TELEGRAM_USER_ID` yang diproses. Pesan lain diabaikan total tanpa balasan.
   - Secret hanya lewat environment variables; `.gitignore` melindungi `.env` dan credential Google Service Account.
2. **Integritas Data & Draf**:
   - Zero-unauthorized-writes: Tidak ada penulisan ke database keuangan maupun Google Calendar tanpa konfirmasi eksplisit lewat draf.
   - Draf transaksi & event kalender disimpan di database libSQL (tabel `drafts`), bukan memori, agar tahan restart Koyeb.
3. **Kalkulasi Keuangan**:
   - Saldo dan semua total rekap dihitung 100% oleh kode TypeScript, bukan oleh LLM.
   - Nilai uang disimpan sebagai integer Rupiah.
   - Tiga dompet utama: Tunai, GoPay, Bank Mandiri.
   - Tipe: Pengeluaran, Pemasukan, dan Transfer (transfer tidak mengubah net income/expense).
4. **Waktu**:
   - Zona waktu acuan mutlak: `Asia/Jakarta` (WIB).
   - Prompt LLM diinjeksi tanggal/jam WIB saat ini + tabel 14 hari ke depan.
5. **Log Grup**:
   - Debounce 1.5 detik untuk menggabungkan batch pesan Telegram.
   - Estimasi ukuran token sebelum dikirim ke Groq; tolak jelas jika terlalu besar (tanpa chunking awal).
   - Teks mentah log grup tidak pernah disimpan di database.
6. **Ketahanan Kuota LLM (Groq)**:
   - Rotator multi-key dengan cooldown saat rate limit (429) & fallback model (`llama-3.3-70b-versatile` -> `llama-3.1-8b-instant`).
   - Mode offline manual deterministik berbasis regex jika seluruh kuota LLM habis.
7. **Infrastruktur & Koyeb**:
   - Koyeb free tier (0.1 vCPU, 512 MB RAM).
   - Evaluasi Bun pada 0.1 vCPU terlebih dahulu; jika CPU melonjak / tidak stabil, fallback ke Node.js.
   - Endpoint `/health` melayani HTTP health check dan pemantauan memori untuk pinger eksternal tiap 5 menit.

## Log Aktivitas
- [2026-10-19 11:17] Membaca PRD.md dan aturan sistem.
- [2026-10-19 11:21] Mengunduh dan memasang `koyeb-cli` v5.12.0 ke `.local\bin`.
- [2026-10-19 11:22] Inisialisasi Git repository dan membuat `.gitignore`.
- [2026-10-19 11:23] Menyusun `worklog.md` dan rencana implementasi lengkap di `docs/superpowers/plans/2026-10-19-omni-bot-architecture-and-skeleton.md`.
- [2026-10-19 11:30] Repository GitHub `https://github.com/algojogacor/omni-bot` dihubungkan dan dipush branch `main`.
- [2026-10-19 11:33] Skema Drizzle (`wallets`, `transactions`, `drafts`, `calendar_events`, `weekly_reports`, `processed_updates`) selesai dibuat.
- [2026-10-19 11:33] Koneksi Turso (`libsql://omni-bot-algojogacor.aws-ap-northeast-1.turso.io`) diuji dan berhasil membuat seluruh tabel serta inisialisasi 3 dompet default (`Tunai`, `GoPay`, `Bank Mandiri`).
- [2026-10-19 11:34] Deployment kerangka awal Bun ke Koyeb (`usual-olwen` -> `omni-bot`) BERHASIL & HEALTHY.
  - Endpoint: `https://usual-olwen-algojogacorbgt-a2be655b.koyeb.app/health`
  - Hasil benchmark: RSS hanya 47.56 MB (dari kuota 512 MB), Heap Used 1.55 MB, uptime stabil.
- [2026-10-19 11:35] Implementasi LedgerService, presisi integer Rupiah, dan kalkulasi saldo/rekap murni kode TypeScript (100% lulus unit & integration test).
- [2026-10-19 11:36] Implementasi GroqRotator dengan round-robin multi-key, 429 rate limit cooldown, dan fallback model otomatis.
- [2026-10-19 11:37] Implementasi parser offline deterministik berbasis regex saat kuota LLM habis.
- [2026-10-19 11:38] Implementasi core bot grammY: dedupe update, debounce queue 1.5 detik untuk paste/forward chat panjang, dan sistem draf persetujuan di DB libSQL.
- [2026-10-19 11:39] Implementasi Google Calendar Service Account (menggunakan `GOOGLE_CLIENT_EMAIL`, `GOOGLE_PRIVATE_KEY`, dan `GOOGLE_CALENDAR_ID`) serta tombol hapus event tersinkronisasi.
- [2026-10-19 11:40] Implementasi WeeklyScheduler (laporan proaktif Minggu 20:00 WIB) dan ekspor CSV.
- [2026-10-19 11:41] Seluruh test suite (16 tests across 6 files) 100% LULUS (`bun test`).
- [2026-10-19 11:43] Deploy versi penuh ke Koyeb dan konfigurasi `TELEGRAM_BOT_TOKEN` baru: Bot aktif live di Koyeb sebagai `@OmniExpenseTracker_bot`.
