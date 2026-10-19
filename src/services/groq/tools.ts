import { TIMEZONE, EXPENSE_CATEGORIES, WALLETS } from "../../config/constants";

export const GROQ_TOOLS = [
  {
    type: "function" as const,
    function: {
      name: "record_transaction",
      description: "Mencatat transaksi pengeluaran atau pemasukan uang pribadi Arya.",
      parameters: {
        type: "object",
        properties: {
          type: {
            type: "string",
            enum: ["expense", "income"],
            description: "'expense' untuk pengeluaran (beli makanan, bayar parkir, dll), 'income' untuk pemasukan (terima transfer, uang saku, gaji).",
          },
          amount: {
            type: "integer",
            description: "Nominal uang dalam bilangan bulat Rupiah (contoh: 18000 untuk 18rb/18k, 250000 untuk 250rb).",
          },
          wallet: {
            type: "string",
            enum: ["Tunai", "GoPay", "Mandiri"],
            description: "Dompet yang digunakan. Jika user tidak menyebutkan dompet, isi null (jangan menebak).",
          },
          category: {
            type: "string",
            enum: [...EXPENSE_CATEGORIES],
            description: "Kategori pengeluaran. Untuk pemasukan, gunakan 'Lainnya'.",
          },
          description: {
            type: "string",
            description: "Deskripsi singkat pengeluaran/pemasukan (misal: 'Kopi susu', 'Makan soto ayam', 'Uang saku dari mama').",
          },
          transaction_date: {
            type: "string",
            description: "Tanggal transaksi format YYYY-MM-DD sesuai waktu WIB. Gunakan tanggal acuan sistem jika 'tadi pagi', 'kemarin', 'lusa', dll.",
          },
        },
        required: ["type", "amount", "description", "transaction_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "transfer_wallet",
      description: "Mencatat perpindahan uang antar dompet Arya (misal: tarik tunai ATM Mandiri ke Tunai, top up GoPay dari Mandiri).",
      parameters: {
        type: "object",
        properties: {
          from_wallet: {
            type: "string",
            enum: ["Tunai", "GoPay", "Mandiri"],
            description: "Dompet sumber/asal uang ditarik.",
          },
          to_wallet: {
            type: "string",
            enum: ["Tunai", "GoPay", "Mandiri"],
            description: "Dompet tujuan uang masuk.",
          },
          amount: {
            type: "integer",
            description: "Nominal uang yang dipindahkan dalam bilangan bulat Rupiah.",
          },
          description: {
            type: "string",
            description: "Keterangan transfer (misal: 'Tarik tunai ATM', 'Top up GoPay').",
          },
          transaction_date: {
            type: "string",
            description: "Tanggal transfer format YYYY-MM-DD sesuai waktu WIB.",
          },
        },
        required: ["from_wallet", "to_wallet", "amount", "description", "transaction_date"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "query_recap",
      description: "Menanyakan rekapitulasi keuangan (pengeluaran/pemasukan) atau menanyakan saldo saat ini untuk periode atau tanggal tertentu.",
      parameters: {
        type: "object",
        properties: {
          period: {
            type: "string",
            enum: ["today", "this_week", "this_month", "last_month"],
            description: "Periode umum rekap jika sesuai (hari ini, minggu ini, bulan ini, bulan lalu).",
          },
          start_date: {
            type: "string",
            description: "Tanggal awal transaksi dalam format YYYY-MM-DD (WIB). Gunakan tabel acuan tanggal jika menanyakan tanggal spesifik seperti 'kemarin', 'tanggal 15', 'senin kemarin', atau rentang tanggal.",
          },
          end_date: {
            type: "string",
            description: "Tanggal akhir transaksi dalam format YYYY-MM-DD (WIB). Untuk pertanyaan 1 hari spesifik, samakan nilainya dengan start_date.",
          },
          category: {
            type: "string",
            description: "Filter kategori spesifik jika ditanya (misal 'Makanan', 'Transport').",
          },
          keyword: {
            type: "string",
            description: "Filter kata kunci pencarian transaksi jika ada (misal 'kopi').",
          },
          ask_balance: {
            type: "boolean",
            description: "Set true jika user menanyakan saldo atau sisa uang saat ini.",
          },
        },
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "summarize_group_log",
      description: "Mengekstrak dan merangkum pesan obrolan grup panjang menjadi TL;DR pengumuman, daftar tugas per orang, dan jadwal/tenggat event.",
      parameters: {
        type: "object",
        properties: {
          tldr: {
            type: "string",
            description: "Ringkasan ringkas poin inti pengumuman, keputusan, atau pembahasan penting.",
          },
          arya_tasks: {
            type: "array",
            items: { type: "string" },
            description: "Daftar tugas spesifik yang menjadi tanggung jawab Arya.",
          },
          other_tasks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                person: { type: "string" },
                task: { type: "string" },
              },
              required: ["person", "task"],
            },
            description: "Daftar tugas untuk anggota kelompok lainnya.",
          },
          events: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                start_time: { type: "string", description: "Format ISO WIB, e.g. 2026-10-20T14:00:00+07:00" },
                end_time: { type: "string", description: "Format ISO WIB jika ada" },
                description: { type: "string" },
              },
              required: ["title", "start_time"],
            },
            description: "Jadwal rapat, tenggat tugas, atau janji temu yang terdeteksi.",
          },
        },
        required: ["tldr", "arya_tasks", "other_tasks", "events"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "create_schedule_event",
      description: "Mencatat rencana jadwal, agenda, janji temu, atau kegiatan baru Arya ke draf Google Calendar.",
      parameters: {
        type: "object",
        properties: {
          title: {
            type: "string",
            description: "Nama kegiatan atau jadwal (misal: 'Sidang Semhas', 'Ujian Hukum Pidana', 'Bimbingan Dosen').",
          },
          start_time: {
            type: "string",
            description: "Waktu mulai dalam format ISO dengan offset WIB, contoh: 2026-10-21T10:00:00+07:00. Gunakan tabel acuan tanggal untuk menentukan tanggal yang tepat.",
          },
          end_time: {
            type: "string",
            description: "Waktu selesai format ISO WIB jika disebutkan (opsional).",
          },
          description: {
            type: "string",
            description: "Keterangan atau lokasi kegiatan jika ada.",
          },
          is_deadline: {
            type: "boolean",
            description: "Set true jika ini adalah tenggat waktu/deadline tugas.",
          },
        },
        required: ["title", "start_time"],
      },
    },
  },
  {
    type: "function" as const,
    function: {
      name: "query_schedule",
      description: "Menanyakan jadwal kegiatan, agenda yang terdaftar di Google Calendar, atau mencari jadwal terdekat.",
      parameters: {
        type: "object",
        properties: {
          time_min: {
            type: "string",
            description: "Batas awal waktu pencarian format ISO WIB (contoh: awal hari yang ditanyakan). Jika menanyakan jadwal terdekat/mendatang, gunakan waktu sekarang.",
          },
          time_max: {
            type: "string",
            description: "Batas akhir waktu pencarian format ISO WIB (contoh: akhir hari yang ditanyakan, atau akhir minggu/bulan).",
          },
          label: {
            type: "string",
            description: "Keterangan rentang waktu pencarian dalam bahasa manusia (misal: 'Hari Ini', 'Besok', 'Senin Depan', 'Minggu Ini', 'Terdekat').",
          },
        },
      },
    },
  },
];

/**
 * Builds the dynamic system prompt with current WIB datetime and 14-day projection
 */
export function buildSystemPrompt(refDate = new Date()): string {
  // Format current date & time in WIB
  const nowWIB = new Intl.DateTimeFormat("id-ID", {
    timeZone: TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).format(refDate);

  // Build 14-day calendar lookup table
  const daysLookup: string[] = [];
  for (let i = -2; i <= 14; i++) {
    const d = new Date(refDate.getTime() + i * 24 * 60 * 60 * 1000);
    const dateStr = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE }).format(d); // YYYY-MM-DD
    const label = new Intl.DateTimeFormat("id-ID", { timeZone: TIMEZONE, weekday: "long", day: "numeric", month: "short" }).format(d);
    let tag = "";
    if (i === -2) tag = " (2 hari lalu)";
    else if (i === -1) tag = " (kemarin)";
    else if (i === 0) tag = " (HARI INI)";
    else if (i === 1) tag = " (besok)";
    else if (i === 2) tag = " (lusa)";
    daysLookup.push(`- ${dateStr}: ${label}${tag}`);
  }

  return `Kamu adalah asisten pribadi cerdas bernama Omni-Bot untuk Arya (mahasiswa hukum di Surabaya).
Gaya bicaramu: ringkas, bahasa Indonesia santai tapi rapi, cekatan, tidak cerewet.

WAKTU ACUAN SAAT INI (WIB / Asia/Jakarta):
${nowWIB} WIB

TABEL ACUAN TANGGAL 14 HARI KE DEPAN (WIB):
${daysLookup.join("\n")}

ATURAN UTAMA:
1. Pahami maksud pengguna dari kalimat kasual apa pun tanpa perlu slash command.
2. JANGAN PERNAH MENGARANG ANGKA ATAU MELAKUKAN PERHITUNGAN MATEMATIKA TOTAL SENDIRI. Semua perhitungan uang dihitung oleh kode sistem, kamu hanya perlu mengekstrak angka ke dalam tool.
3. Nominal uang disimpan sebagai bilangan bulat Rupiah (contoh: 18k / 18rb = 18000, 1.5jt = 1500000).
4. Tiga dompet Arya: Tunai, GoPay, dan Bank Mandiri.
   - Jika dompet disebut ("kopi 18k gopay"), set parameter wallet ke 'GoPay'.
   - Jika dompet TIDAK disebut ("makan soto 20rb"), set parameter wallet ke null. Sistem akan menanyakan dompet ke Arya.
5. Transfer memindahkan saldo antar dompet (misal: 'tarik tunai 50k', 'top up gopay 100k dari mandiri') -> Panggil tool 'transfer_wallet'.
6. Jika user tanya rekap, saldo, atau sisa uang -> Panggil tool 'query_recap'.
7. Jika user ingin mencatat jadwal/kegiatan/agenda pribadi ("saya lusa jam 10 ada sidang semhas", "besok jam 2 siang ada rapat") -> Panggil tool 'create_schedule_event'.
8. Jika user menanyakan jadwal/kegiatan ("apa jadwal terdekat saya?", "senin depan ada jadwal apa?", "hari ini ada jadwal apa?") -> Panggil tool 'query_schedule'.
9. Jika teks berupa log obrolan grup panjang atau forward chat -> Panggil tool 'summarize_group_log'.
10. Jawab ringkas dan jelas.`;
}
