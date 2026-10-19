import { Bot } from "grammy";
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { weeklyReports } from "../../db/schema";
import { LedgerService } from "../ledger/service";
import { formatRupiah, getWIBDateRange } from "../ledger/math";
import { env } from "../../config/env";
import { TIMEZONE } from "../../config/constants";

/**
 * Returns current ISO year-week format, e.g. "2026-W42" in Asia/Jakarta
 */
export function getWIBYearWeek(date = new Date()): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, "0")}`;
}

export class WeeklyScheduler {
  private static intervalHandle: any = null;

  /**
   * Starts periodic check every 10 minutes to see if Sunday 20:00 WIB has passed and report is pending
   */
  static start(bot: Bot) {
    if (this.intervalHandle) return;

    console.log("[WeeklyScheduler] Initialized weekly proactive report scheduler.");

    // Initial check on boot (in case instance just restarted after 20:00 WIB)
    this.checkAndSendReport(bot).catch((err) =>
      console.error("[WeeklyScheduler] Initial check error:", err)
    );

    // Run check every 10 minutes
    this.intervalHandle = setInterval(() => {
      this.checkAndSendReport(bot).catch((err) =>
        console.error("[WeeklyScheduler] Interval check error:", err)
      );
    }, 10 * 60 * 1000);
  }

  static stop() {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  static async checkAndSendReport(bot: Bot) {
    if (!env.ALLOWED_TELEGRAM_USER_ID) return;

    // Check current WIB day and time
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: TIMEZONE,
      weekday: "short",
      hour: "numeric",
      hour12: false,
    });
    const parts = formatter.formatToParts(now);
    const weekday = parts.find((p) => p.type === "weekday")?.value; // "Sun", "Mon", etc.
    const hour = parseInt(parts.find((p) => p.type === "hour")?.value || "0", 10);

    const yearWeek = getWIBYearWeek(now);

    // Only send on Sunday at or after 20:00 WIB (or Monday morning catchup if slept through Sunday)
    const isReportTime = (weekday === "Sun" && hour >= 20) || (weekday === "Mon" && hour < 12);
    if (!isReportTime) return;

    // Check if already sent in DB
    const alreadySent = await db
      .select()
      .from(weeklyReports)
      .where(eq(weeklyReports.yearWeek, yearWeek))
      .get();

    if (alreadySent) {
      // Already sent for this week
      return;
    }

    console.log(`[WeeklyScheduler] Generating weekly financial report for ${yearWeek}...`);

    // Generate recap for this week
    const recap = await LedgerService.getRecap({ period: "this_week" });
    const wallets = await LedgerService.getWallets();

    // Find highest expense category
    let topCategory = "-";
    let topCategoryAmount = 0;
    for (const [cat, amt] of Object.entries(recap.categoryBreakdown)) {
      if (amt > topCategoryAmount) {
        topCategoryAmount = amt;
        topCategory = cat;
      }
    }

    let reportMsg = `📊 *RINGKASAN MINGGUAN KEUANGAN*\n`;
    reportMsg += `📅 Periode: ${recap.dateRangeLabel}\n\n`;

    reportMsg += `👛 *SALDO PER DOMPET*:\n`;
    let totalAllWallets = 0;
    for (const w of wallets) {
      reportMsg += `• ${w.name}: ${formatRupiah(w.balance)}\n`;
      totalAllWallets += w.balance;
    }
    reportMsg += `👉 *Total Kas*: ${formatRupiah(totalAllWallets)}\n\n`;

    reportMsg += `📈 *MUTASI MINGGU INI*:\n`;
    reportMsg += `• Total Pemasukan: ${formatRupiah(recap.totalIncome)}\n`;
    reportMsg += `• Total Pengeluaran: ${formatRupiah(recap.totalExpense)}\n`;
    reportMsg += `• Tabungan Bersih: ${formatRupiah(recap.netSavings)}\n`;
    if (topCategoryAmount > 0) {
      reportMsg += `• Kategori Terbesar: ${topCategory} (${formatRupiah(topCategoryAmount)})\n`;
    }
    reportMsg += `\n_Semangat menjalani perkuliahan dan aktivitas minggu depan, Arya!_ 🚀`;

    try {
      await bot.api.sendMessage(env.ALLOWED_TELEGRAM_USER_ID, reportMsg, {
        parse_mode: "Markdown",
      });

      // Save report record in database
      await db.insert(weeklyReports).values({
        id: crypto.randomUUID(),
        yearWeek,
        sentAt: new Date().toISOString(),
        summaryText: reportMsg,
      });

      console.log(`✅ [WeeklyScheduler] Successfully sent weekly report for ${yearWeek}.`);
    } catch (err) {
      console.error(`❌ [WeeklyScheduler] Failed to send report:`, err);
    }
  }
}
