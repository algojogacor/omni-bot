# Omni-Bot Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Membangun Omni-Bot: bot Telegram personal untuk Arya (mahasiswa hukum di Surabaya) berbasis Bun + TypeScript + grammY + Turso/Drizzle + Groq + Google Calendar, dengan aturan ketat buku kas per dompet, rekapitulator, perangkum obrolan grup, sistem draf konfirmasi, dan deploy ke Koyeb free tier.

**Architecture:** Modular architecture dengan pemisahan tegas antara layer Telegram (auth/dedupe/debounce/drafts), service parsing (Groq rotator + deterministic fallback), ledger engine (aritmatika 100% di kode TypeScript, integer IDR, 3 dompet), dan service eksternal (Google Calendar API & weekly cron).

**Tech Stack:** Bun 1.4+, TypeScript, grammY, @libsql/client (Turso), drizzle-orm, groq-sdk, googleapis (Service Account), Docker / Koyeb CLI.

---

### File Structure Map

```
omni-bot/
├── docs/
│   └── superpowers/
│       └── plans/
│           └── 2026-10-19-omni-bot-architecture-and-skeleton.md
├── src/
│   ├── config/
│   │   ├── env.ts              # Validasi Zod untuk environment variables
│   │   └── constants.ts        # Dompet (Tunai, GoPay, Mandiri), kategori transaksi, timezone WIB
│   ├── db/
│   │   ├── schema.ts           # Skema Drizzle: wallets, transactions, drafts, calendar_events, processed_updates
│   │   └── index.ts            # Client libSQL / Turso connection
│   ├── services/
│   │   ├── ledger/
│   │   │   ├── math.ts         # Perhitungan saldo dan total murni kode (integer Rupiah)
│   │   │   └── service.ts      # Query transaksi, rekap saldo & mutasi
│   │   ├── groq/
│   │   │   ├── rotator.ts      # Multi-key rotator round-robin, cooldown 429, model fallback
│   │   │   └── tools.ts        # Definisi tool calling LLM (transaksi, transfer, rekap, event)
│   │   ├── parser/
│   │   │   ├── deterministic.ts # Parser regex offline saat kuota LLM habis
│   │   │   └── group_log.ts    # Filter & validator log grup (TL;DR, tugas per nama, draf jadwal)
│   │   ├── calendar/
│   │   │   └── google.ts       # Integrasi Google Calendar lewat Service Account
│   │   └── scheduler/
│   │       └── weekly.ts       # Cron ringkasan mingguan (Minggu 20:00 WIB, dedupe per minggu)
│   ├── bot/
│   │   ├── middlewares/
│   │   │   ├── auth.ts         # Filter hanya user ID ALLOWED_TELEGRAM_USER_ID
│   │   │   ├── dedupe.ts       # Proteksi update Telegram duplikat
│   │   │   └── debounce.ts     # Penampung 1.5 detik untuk paste/forward beruntun
│   │   ├── keyboard.ts         # Inline keyboard: tombol Simpan, Batal, Edit, Pilih Dompet
│   │   ├── handlers/
│   │   │   ├── text.ts         # Handler pesan teks kasual & koreksi draf
│   │   │   ├── callback.ts     # Handler tombol interaktif Telegram
│   │   │   └── export.ts       # Handler ekspor riwayat keuangan ke file CSV
│   │   └── bot.ts              # Inisialisasi bot grammY
│   ├── server/
│   │   └── health.ts           # HTTP server Bun untuk /health & status memori
│   └── index.ts                # Entrypoint: inisialisasi database, server health, dan long polling
├── tests/
│   ├── ledger.test.ts          # Unit test perhitungan saldo & mutasi
│   ├── rotator.test.ts         # Unit test rotasi key & fallback model
│   ├── deterministic.test.ts   # Unit test parser regex kasual tanpa LLM
│   └── debounce.test.ts        # Unit test buffer 1.5s
├── Dockerfile                  # Container definition berbasis oven/bun:1-alpine
├── koyeb.yaml                  # Konfigurasi deploy Koyeb
├── drizzle.config.ts           # Konfigurasi migrasi Drizzle
├── package.json
├── tsconfig.json
├── worklog.md
└── .env.example
```

---

### Task 1: Minimal Bun Skeleton & Koyeb Deployment Readiness (Phase 1)

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/config/env.ts`
- Create: `src/server/health.ts`
- Create: `src/index.ts`
- Create: `Dockerfile`
- Create: `koyeb.yaml`
- Create: `.env.example`

- [ ] **Step 1: Inisialisasi project Bun dengan dependencies utama**

Run:
```bash
bun add grammy @libsql/client drizzle-orm groq-sdk googleapis zod dotenv
bun add -d drizzle-kit @types/bun typescript
```

- [ ] **Step 2: Buat `tsconfig.json`**

Konfigurasi TypeScript modern untuk Bun dengan type safety ketat (`strict: true`).

- [ ] **Step 3: Buat `src/server/health.ts`**

HTTP server Bun bawaan yang menyajikan endpoint `GET /health` mengembalikan status `ok`, waktu server WIB, uptime, dan detail `process.memoryUsage()`.

- [ ] **Step 4: Buat `src/index.ts` sebagai entrypoint awal**

Menjalankan health server pada port `PORT || 8000`.

- [ ] **Step 5: Buat `Dockerfile` berbasis `oven/bun:1-alpine`**

Optimasi container untuk memori rendah (< 50MB) dan startup kilat.

- [ ] **Step 6: Buat `koyeb.yaml` dan verifikasi deployment awal ke Koyeb**

Pastikan instance Koyeb 0.1 vCPU berhasil build, lolos healthcheck di `/health`, dan tidak ada crash loop.

---

### Task 2: Database Schema & Drizzle libSQL Setup

**Files:**
- Create: `src/config/constants.ts`
- Create: `src/db/schema.ts`
- Create: `src/db/index.ts`
- Create: `drizzle.config.ts`

- [ ] **Step 1: Definisikan enum & konstanta di `src/config/constants.ts`**
  - Dompet: `Tunai`, `GoPay`, `Mandiri`
  - Kategori Pengeluaran: `Makanan`, `Transport`, `Kuliah/Organisasi`, `Hiburan`, `Tagihan`, `Lainnya`
  - Timezone: `Asia/Jakarta`

- [ ] **Step 2: Definisikan skema tabel Drizzle di `src/db/schema.ts`**
  - `wallets`: id, name (primary/unique), balance (integer), updated_at
  - `transactions`: id, type ('expense' | 'income' | 'transfer'), amount (integer), wallet_id, to_wallet_id, category, description, date (ISO string WIB), created_at
  - `drafts`: id, type ('transaction' | 'transfer' | 'calendar_event' | 'group_extraction'), payload (JSON text), status ('pending' | 'approved' | 'rejected' | 'superseded'), telegram_message_id, created_at, updated_at
  - `calendar_events`: id, draft_id, google_event_id, title, start_time, end_time, description, status, created_at
  - `weekly_reports`: id, year_week (unique), sent_at, summary_text
  - `processed_updates`: update_id (primary key), processed_at

- [ ] **Step 3: Setup database client di `src/db/index.ts`**
  - Menggunakan `@libsql/client` (mendukung Turso remote URL maupun file SQLite lokal untuk dev).

---

### Task 3: Ledger Engine & Code-Level Arithmetic

**Files:**
- Create: `src/services/ledger/math.ts`
- Create: `src/services/ledger/service.ts`
- Test: `tests/ledger.test.ts`

- [ ] **Step 1: Tulis unit test `tests/ledger.test.ts`**
  - Uji penambahan pengeluaran mengurangi saldo dompet
  - Uji penambahan pemasukan menambah saldo dompet
  - Uji transfer memindahkan saldo dari dompet A ke dompet B tanpa mengubah saldo total bersih
  - Uji rekap saldo dan breakdown kategori bulanan
  - Uji formatting angka Rupiah: `Rp18.000`

- [ ] **Step 2: Implementasi `math.ts` dan `service.ts`**
  - Seluruh kalkulasi murni integer `number` di TypeScript. Tidak mempercayakan matematika ke LLM.

- [ ] **Step 3: Jalankan test untuk memverifikasi perhitungan**
Run: `bun test tests/ledger.test.ts`
Expected: PASS

---

### Task 4: Groq Multi-Key Rotator & Fallback Engine

**Files:**
- Create: `src/services/groq/rotator.ts`
- Create: `src/services/groq/tools.ts`
- Test: `tests/rotator.test.ts`

- [ ] **Step 1: Tulis test `tests/rotator.test.ts`**
  - Uji rotasi round-robin antar key
  - Uji key yang menerima error 429 masuk masa cooldown (misal 60 detik)
  - Uji saat seluruh key di model primer limit, otomatis fallback ke model sekunder (`llama-3.1-8b-instant`)
  - Uji deteksi ketika SEMUA key dan model habis, mengembalikan error `QUOTA_EXHAUSTED`

- [ ] **Step 2: Implementasi `rotator.ts` dan definisi tool calling di `tools.ts`**
  - Tools terpisah: `record_transaction`, `transfer_wallet`, `query_recap`, `extract_group_events`
  - Menyertakan context waktu WIB saat ini dan tabel proyeksi 14 hari ke depan dalam prompt sistem.

- [ ] **Step 3: Jalankan test rotator**
Run: `bun test tests/rotator.test.ts`
Expected: PASS

---

### Task 5: Deterministic Offline Parser (Fallback saat LLM Habis)

**Files:**
- Create: `src/services/parser/deterministic.ts`
- Test: `tests/deterministic.test.ts`

- [ ] **Step 1: Tulis test `tests/deterministic.test.ts`**
  - Uji variasi: "kopi 18rb gopay", "makan siang 25k tunai", "transfer 50rb dari mandiri ke gopay", "bensin 20.000" (tanya dompet)
  - Uji penanganan unit: "rb", "k", "ribu", "000"

- [ ] **Step 2: Implementasi regex parser deterministik**
  - Menghasilkan draf terstruktur yang siap ditampilkan ke user dengan tombol konfirmasi/edit.

- [ ] **Step 3: Jalankan test parser**
Run: `bun test tests/deterministic.test.ts`
Expected: PASS

---

### Task 6: Telegram Bot Core (Auth, Dedupe, Debounce & Draft UI)

**Files:**
- Create: `src/bot/middlewares/auth.ts`
- Create: `src/bot/middlewares/dedupe.ts`
- Create: `src/bot/middlewares/debounce.ts`
- Create: `src/bot/keyboard.ts`
- Create: `src/bot/handlers/text.ts`
- Create: `src/bot/handlers/callback.ts`
- Create: `src/bot/bot.ts`
- Test: `tests/debounce.test.ts`

- [ ] **Step 1: Auth Middleware**
  - Validasi ketat `ctx.from?.id.toString() === process.env.ALLOWED_TELEGRAM_USER_ID`. Jika tidak cocok, abaikan tanpa respon (silent drop).

- [ ] **Step 2: Dedupe Middleware**
  - Periksa `update_id` di database / cache memory berbatas untuk mencegah duplikasi eksekusi pesan dari Telegram.

- [ ] **Step 3: Debounce Middleware (1.5 detik)**
  - Menggabungkan pesan-pesan forward panjang yang datang terpecah dalam jendela 1.5 detik.

- [ ] **Step 4: Draft Lifecycle & UI Inline Keyboard**
  - Tampilkan draf dengan rincian jelas (Tanggal WIB, Tipe, Dompet, Nominal, Kategori/Catatan).
  - Tombol: `✅ Simpan`, `✏️ Edit`, `❌ Batal`.
  - Jika dompet hilang: Tombol pilihan `💵 Tunai`, `📱 GoPay`, `🏦 Mandiri`.
  - Simpan draf ke tabel `drafts` di database.
  - Dukung revisi draf lewat pesan teks biasa ("yang parkir harusnya 5rb").

---

### Task 7: Group Chat Summarizer & Extractor

**Files:**
- Create: `src/services/parser/group_log.ts`

- [ ] **Step 1: Implementasi estimasi panjang token**
  - Cek panjang pesan. Jika melebihi batas model (misal > 10.000 token), tolak dengan ramah: *"Log terlalu panjang untuk diproses sekaligus, silakan kirim per bagian."*

- [ ] **Step 2: Ekstraksi terstruktur via LLM**
  - Output Markdown rapi:
    1. **TL;DR**: Poin inti pengumuman/keputusan.
    2. **Daftar Tugas**: Tugas Arya disorot di paling atas, diikuti tugas anggota lain.
    3. **Jadwal & Deadline**: Disajikan sebagai draf event kalender yang dapat disetujui.
  - Teks mentah log grup tidak pernah disimpan ke DB (hanya hasil draf yang disetujui disimpan).

---

### Task 8: Google Calendar Service Account Integration

**Files:**
- Create: `src/services/calendar/google.ts`

- [ ] **Step 1: Client Google Calendar via Service Account**
  - Autentikasi menggunakan credentials service account (via env `GOOGLE_SERVICE_ACCOUNT_KEY` JSON).
  - Sinkronisasi event ke kalender Arya (`GOOGLE_CALENDAR_ID`).
  - Default durasi: 1 jam untuk acara/pertemuan, 30 menit untuk tenggat tugas.

- [ ] **Step 2: Simpan ID event Google di DB & fitur Hapus Event**
  - Simpan `google_event_id` di tabel `calendar_events`.
  - Sediakan tombol `Hapus dari Google Calendar` jika event yang sudah disinkronkan ingin dibatalkan.

---

### Task 9: Operational Tools & Weekly Proactive Summary

**Files:**
- Create: `src/services/scheduler/weekly.ts`
- Create: `src/bot/handlers/export.ts`

- [ ] **Step 1: Ringkasan Mingguan Otomatis**
  - Cron berjalan tiap Minggu malam (~20:00 WIB).
  - Periksa apakah ringkasan untuk minggu tersebut (`year_week`, misal `2026-W42`) sudah terkirim di `weekly_reports`.
  - Format pesan: Saldo tiap dompet, total pemasukan & pengeluaran minggu ini, pengeluaran kategori terbesar.

- [ ] **Step 2: Notifikasi Error Sistem ke Telegram Arya**
  - Jika terjadi error fatal (DB unreachable, key habis total, gagal sync kalender), kirim notifikasi ringkas ke chat Arya.

- [ ] **Step 3: Ekspor CSV**
  - Keyword/perintah ekspor ("export csv" / "unduh data") menghasilkan file CSV transaksi dan mengirimkannya via Telegram `sendDocument`.

---

### Task 10: Integrasi Akhir, Verifikasi & Uji Deployment

- [ ] **Step 1: Jalankan seluruh test suite**
Run: `bun test`
Expected: Semua test unit lulus (100% pass)

- [ ] **Step 2: Build & verifikasi Docker container lokal**
Run: `docker build -t omni-bot .` atau test `bun run src/index.ts`

- [ ] **Step 3: Deploy kerangka awal ke Koyeb & ukur performa CPU/RAM**
  - Monitor metrik di Koyeb instance (memastikan idle CPU rendah di 0.1 vCPU dan RAM < 50 MB).
