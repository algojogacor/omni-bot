# Omni-Bot 🤖

Omni-Bot adalah bot Telegram personal untuk Arya (mahasiswa hukum di Surabaya) yang berfungsi sebagai buku kas per dompet (Tunai, GoPay, Bank Mandiri), rekapitulator keuangan, dan perangkum obrolan grup panjang (TL;DR, daftar tugas per orang, dan jadwal/tenggat ke Google Calendar).

## Fitur Utama

- **Zero-Unauthorized-Writes**: Tidak ada penulisan ke database atau Google Calendar tanpa persetujuan eksplisit melalui draf konfirmasi.
- **Aritmatika Presisi**: Saldo dan rekap dihitung 100% oleh kode TypeScript (bilangan bulat Rupiah), bukan oleh LLM.
- **Dukungan 3 Dompet**: Tunai, GoPay, dan Bank Mandiri.
- **Waktu Acuan WIB**: Semua batas hari, minggu, dan bulan memakai zona waktu `Asia/Jakarta`.
- **Rotator Multi-Key Groq**: Round-robin key dengan cooldown otomatis saat rate-limit dan model fallback.
- **Offline Fallback Parser**: Tetap dapat mencatat transaksi sederhana ("kopi 18rb gopay") dengan parser deterministik jika kuota LLM habis.
- **Perangkum Log Grup**: Menghasilkan ringkasan TL;DR, daftar tugas (tugas Arya disorot di atas), dan draf event Google Calendar tanpa menyimpan teks mentah log grup.
- **Ringkasan Mingguan Otomatis**: Laporan keuangan dikirim proaktif setiap Minggu malam WIB.
- **Ekspor CSV**: Cadangkan data transaksi kapan saja.

## Tech Stack

- **Runtime**: Bun + TypeScript
- **Bot Framework**: grammY (long polling)
- **Database**: Turso (libSQL) + Drizzle ORM
- **LLM**: Groq (Llama 3.3 70B & Llama 3.1 8B)
- **Kalender**: Google Calendar API (Service Account)
- **Deployment**: Koyeb (0.1 vCPU, 512 MB) dengan endpoint `/health`
