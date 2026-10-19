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
- [2026-10-19 11:23] Menyusun `worklog.md` dan rencana implementasi lengkap.
