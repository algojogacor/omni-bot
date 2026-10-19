import { MAX_GROUP_LOG_ESTIMATED_TOKENS } from "../../config/constants";

export interface GroupLogValidation {
  isValid: boolean;
  estimatedTokens: number;
  rejectionReason?: string;
}

export class GroupLogParser {
  /**
   * Estimates tokens and validates if the group log is within safe limits for Groq
   */
  static validateSize(text: string): GroupLogValidation {
    // Standard rule of thumb: ~4 characters per token in mixed Indonesian / code / symbols
    const estimatedTokens = Math.ceil(text.length / 4);

    if (estimatedTokens > MAX_GROUP_LOG_ESTIMATED_TOKENS) {
      return {
        isValid: false,
        estimatedTokens,
        rejectionReason:
          `⚠️ *Log obrolan terlalu panjang* (sekitar ${estimatedTokens.toLocaleString("id-ID")} token, batas maksimal ~${MAX_GROUP_LOG_ESTIMATED_TOKENS.toLocaleString("id-ID")}).\n` +
          `Silakan salin atau teruskan log dalam bagian yang lebih ringkas agar dapat diringkas dengan akurat.`,
      };
    }

    return {
      isValid: true,
      estimatedTokens,
    };
  }

  /**
   * Formats the extracted group summary into a tidy, human-readable Telegram markdown card
   */
  static formatSummaryCard(summary: {
    tldr: string;
    aryaTasks: string[];
    otherTasks: Array<{ person: string; task: string }>;
    events: Array<{ title: string; startTime: string; endTime?: string; description?: string }>;
  }): string {
    let card = `📌 *RINGKASAN OBROLAN GRUP*\n\n`;

    // 1. TL;DR
    card += `📖 *TL;DR (Pengumuman & Keputusan)*:\n${summary.tldr.trim()}\n\n`;

    // 2. Arya's Tasks (Highlighted at top)
    card += `🎯 *TUGAS ARYA*:\n`;
    if (summary.aryaTasks.length > 0) {
      summary.aryaTasks.forEach((t) => {
        card += `• ${t}\n`;
      });
    } else {
      card += `• _Tidak ada tugas spesifik untuk Arya._\n`;
    }
    card += `\n`;

    // 3. Other Members' Tasks
    card += `👥 *TUGAS ANGGOTA KELOMPOK LAIN*:\n`;
    if (summary.otherTasks.length > 0) {
      summary.otherTasks.forEach((item) => {
        card += `• *${item.person}*: ${item.task}\n`;
      });
    } else {
      card += `• _Tidak ada tugas anggota lain yang terdeteksi._\n`;
    }
    card += `\n`;

    // 4. Events / Deadlines
    card += `📅 *JADWAL & TENGGAT (DRAF EVENT)*:\n`;
    if (summary.events.length > 0) {
      summary.events.forEach((ev, idx) => {
        card += `${idx + 1}. *${ev.title}*\n   ⏰ ${ev.startTime}${ev.description ? ` (${ev.description})` : ""}\n`;
      });
      card += `\n_Gunakan tombol di bawah untuk memasukkan event ke Google Calendar._`;
    } else {
      card += `• _Tidak ada jadwal atau tenggat baru._\n`;
    }

    return card;
  }
}
