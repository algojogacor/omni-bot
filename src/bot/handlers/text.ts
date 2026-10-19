import { Context, InputFile } from "grammy";
import { GroqRotator, QuotaExhaustedError } from "../../services/groq/rotator";
import { GROQ_TOOLS, buildSystemPrompt } from "../../services/groq/tools";
import { parseDeterministicMessage } from "../../services/parser/deterministic";
import { GroupLogParser } from "../../services/parser/group_log";
import { DraftManager } from "../../services/draft/manager";
import { LedgerService } from "../../services/ledger/service";
import { BotKeyboards } from "../keyboard";
import { formatRupiah, parseRupiahAmount } from "../../services/ledger/math";
import { env } from "../../config/env";
import { EXPENSE_CATEGORIES } from "../../config/constants";

let groqRotator: GroqRotator | null = null;
if (env.GROQ_API_KEYS) {
  const keys = env.GROQ_API_KEYS.split(",").map((k) => k.trim()).filter((k) => k.length > 0);
  groqRotator = new GroqRotator({
    apiKeys: keys,
    primaryModel: env.GROQ_PRIMARY_MODEL,
    fallbackModel: env.GROQ_FALLBACK_MODEL,
  });
}

export async function handleUserText(ctx: Context, text: string) {
  const userId = ctx.from?.id?.toString() || "";
  const lower = text.trim().toLowerCase();

  // 0. Check /start command
  if (lower === "/start") {
    await ctx.reply(
      "👋 *Halo Arya! Saya Omni-Bot, asisten pribadi kamu.*\n\n" +
      "Ketik apa saja secara kasual tanpa perlu mengingat perintah:\n\n" +
      "👛 *Catat Transaksi*:\n" +
      "• _'kopi susu 18rb gopay'_\n" +
      "• _'makan soto ayam 25k tunai'_\n" +
      "• _'dapat 100rb dari mama masuk mandiri'_\n\n" +
      "🔄 *Pindah Saldo (Transfer)*:\n" +
      "• _'transfer 50rb dari mandiri ke gopay'_\n" +
      "• _'tarik tunai 100k dari mandiri'_\n\n" +
      "📊 *Cek Saldo & Rekap*:\n" +
      "• _'saldo'_ atau _'uangku tinggal berapa'_\n" +
      "• _'rekap hari ini'_ atau _'pengeluaran minggu ini'_\n\n" +
      "📋 *Log Obrolan Grup*:\n" +
      "• Paste/forward log grup panjang -> saya rangkumkan TL;DR, daftar tugas (tugasmu di paling atas), dan jadwal ke Google Calendar.\n\n" +
      "_Semua transaksi selalu ditampilkan sebagai draf terlebih dahulu untuk kamu setujui sebelum disimpan ke buku kas!_",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // 1. Check CSV export command
  if (/^(export\s+csv|unduh\s+(?:data|csv)|download\s+csv|cadangan)$/i.test(lower)) {
    const csvContent = await LedgerService.exportCSV();
    const dateStr = new Date().toISOString().slice(0, 10);
    const buffer = Buffer.from(csvContent, "utf-8");
    await ctx.replyWithDocument(new InputFile(buffer, `omni-bot-keuangan-${dateStr}.csv`), {
      caption: `📁 Berikut cadangan data riwayat keuangan kamu per tanggal *${dateStr}*.`,
      parse_mode: "Markdown",
    });
    return;
  }

  // 2. Check if user is attempting a conversational edit on the latest pending draft
  const pendingDraft = await DraftManager.getLatestPendingDraft(userId);
  if (pendingDraft) {
    const isEditIntent =
      lower.includes("ganti") ||
      lower.includes("harusnya") ||
      lower.includes("bukan") ||
      lower.includes("ubah") ||
      lower.includes("koreksi") ||
      lower.includes("salah") ||
      /^(tunai|gopay|mandiri)$/i.test(lower) ||
      parseRupiahAmount(text) !== null;

    if (isEditIntent) {
      const payload = JSON.parse(pendingDraft.payload);
      let updated = false;

      // Check if wallet mentioned
      if (lower.includes("gopay")) {
        payload.wallet = "GoPay";
        updated = true;
      } else if (lower.includes("mandiri")) {
        payload.wallet = "Mandiri";
        updated = true;
      } else if (lower.includes("tunai")) {
        payload.wallet = "Tunai";
        updated = true;
      }

      // Check if new amount mentioned
      const newAmt = parseRupiahAmount(text);
      if (newAmt !== null) {
        payload.amount = newAmt;
        updated = true;
      }

      // Check if category mentioned
      for (const cat of EXPENSE_CATEGORIES) {
        if (lower.includes(cat.toLowerCase())) {
          payload.category = cat;
          updated = true;
          break;
        }
      }

      if (updated) {
        const revised = await DraftManager.updateDraft(pendingDraft.id, payload);
        const cardText = DraftManager.formatDraftCard(revised);
        const kb = revised.type === "transaction" && !JSON.parse(revised.payload).wallet
          ? BotKeyboards.walletPicker(revised.id)
          : BotKeyboards.draftConfirmation(revised.id);

        await ctx.reply(`✏️ *Draf diperbarui:*\n\n${cardText}`, {
          parse_mode: "Markdown",
          reply_markup: kb,
        });
        return;
      }
    }
  }

  // 3. Check group log size
  const logValidation = GroupLogParser.validateSize(text);
  if (!logValidation.isValid) {
    await ctx.reply(logValidation.rejectionReason!, { parse_mode: "Markdown" });
    return;
  }

  // 4. Try Processing with Groq LLM
  if (groqRotator && groqRotator.getKeyCount() > 0) {
    try {
      await processWithGroq(ctx, text, userId);
      return;
    } catch (err) {
      if (err instanceof QuotaExhaustedError) {
        console.warn("[TextHandler] Groq quota exhausted across all keys and models. Falling back to deterministic mode.");
        await ctx.reply(
          "⚠️ *Kuota LLM (Groq) sedang habis hari ini.*\n" +
          "Beralih otomatis ke *mode manual deterministik*. Pesan sederhana seperti _'kopi 18rb gopay'_ tetap bisa dicatat, namun rangkuman log grup belum dapat diproses.",
          { parse_mode: "Markdown" }
        );
      } else {
        console.error("[TextHandler] Unexpected Groq error:", err);
        // Fall through to deterministic parser
      }
    }
  }

  // 5. Deterministic Offline Parser Fallback
  await processWithDeterministic(ctx, text, userId);
}

/**
 * Handles message via Groq Tool Calling
 */
async function processWithGroq(ctx: Context, text: string, userId: string) {
  if (!groqRotator) return;

  const systemPrompt = buildSystemPrompt();

  await groqRotator.executeWithRetry(async ({ client, model }) => {
    const response = await client.chat.completions.create({
      model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: text },
      ],
      tools: GROQ_TOOLS,
      tool_choice: "auto",
      temperature: 0.1,
    });

    const choice = response.choices[0];
    const message = choice?.message;

    // Check if tools were called
    if (message?.tool_calls && message.tool_calls.length > 0) {
      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        const fnName = call.function.name;
        const args = JSON.parse(call.function.arguments);

        if (fnName === "record_transaction") {
          const draft = await DraftManager.createDraft(userId, "transaction", {
            type: args.type || "expense",
            amount: args.amount,
            wallet: args.wallet || null,
            category: args.category || "Lainnya",
            description: args.description || "Catatan",
            transactionDate: args.transaction_date || new Date().toISOString().slice(0, 10),
          });

          const card = DraftManager.formatDraftCard(draft);
          const kb = !args.wallet
            ? BotKeyboards.walletPicker(draft.id)
            : BotKeyboards.draftConfirmation(draft.id);

          await ctx.reply(card, { parse_mode: "Markdown", reply_markup: kb });
          return;
        }

        if (fnName === "transfer_wallet") {
          const draft = await DraftManager.createDraft(userId, "transfer", {
            fromWallet: args.from_wallet,
            toWallet: args.to_wallet,
            amount: args.amount,
            description: args.description || `Transfer dari ${args.from_wallet} ke ${args.to_wallet}`,
            transactionDate: args.transaction_date || new Date().toISOString().slice(0, 10),
          });

          const card = DraftManager.formatDraftCard(draft);
          await ctx.reply(card, {
            parse_mode: "Markdown",
            reply_markup: BotKeyboards.draftConfirmation(draft.id),
          });
          return;
        }

        if (fnName === "query_recap") {
          const recap = await LedgerService.getRecap({
            period: args.period,
            category: args.category,
            keyword: args.keyword,
          });

          let recapMsg = `📊 *REKAP KEUANGAN*\n`;
          recapMsg += `📅 Rentang: ${recap.dateRangeLabel}\n\n`;

          if (args.ask_balance) {
            recapMsg += `👛 *SALDO PER DOMPET*:\n`;
            let totalCash = 0;
            for (const w of recap.currentWallets) {
              recapMsg += `• ${w.name}: ${formatRupiah(w.balance)}\n`;
              totalCash += w.balance;
            }
            recapMsg += `👉 *Total Uang*: ${formatRupiah(totalCash)}\n\n`;
          }

          recapMsg += `• Total Pengeluaran: ${formatRupiah(recap.totalExpense)}\n`;
          recapMsg += `• Total Pemasukan: ${formatRupiah(recap.totalIncome)}\n`;
          recapMsg += `• Sisa Bersih: ${formatRupiah(recap.netSavings)}\n`;

          if (Object.keys(recap.categoryBreakdown).length > 0) {
            recapMsg += `\n🏷 *Rincian Kategori*:\n`;
            for (const [cat, amt] of Object.entries(recap.categoryBreakdown)) {
              recapMsg += `• ${cat}: ${formatRupiah(amt)}\n`;
            }
          }

          await ctx.reply(recapMsg, { parse_mode: "Markdown" });
          return;
        }

        if (fnName === "summarize_group_log") {
          const draft = await DraftManager.createDraft(userId, "group_extraction", {
            tldr: args.tldr,
            aryaTasks: args.arya_tasks || [],
            otherTasks: args.other_tasks || [],
            events: args.events || [],
          });

          const summaryCard = GroupLogParser.formatSummaryCard(args);
          await ctx.reply(summaryCard, { parse_mode: "Markdown" });

          // If events exist, prompt with buttons to sync to Google Calendar
          if (args.events && args.events.length > 0) {
            for (let i = 0; i < args.events.length; i++) {
              const ev = args.events[i];
              await ctx.reply(
                `📅 Draf Event #${i + 1}: *${ev.title}*\n⏰ ${ev.start_time}`,
                {
                  parse_mode: "Markdown",
                  reply_markup: BotKeyboards.calendarEventSync(draft.id, i),
                }
              );
            }
          }
          return;
        }
      }
    }

    // Default conversational reply if no tool was called
    if (message?.content) {
      await ctx.reply(message.content);
    }
  });
}

/**
 * Handles message via Deterministic offline regex parser
 */
async function processWithDeterministic(ctx: Context, text: string, userId: string) {
  const result = parseDeterministicMessage(text);

  if (result.intent === "transaction") {
    const draft = await DraftManager.createDraft(userId, "transaction", {
      type: result.data.type,
      amount: result.data.amount,
      wallet: result.data.wallet,
      category: result.data.category,
      description: result.data.description,
      transactionDate: result.data.transactionDate,
    });

    const card = DraftManager.formatDraftCard(draft);
    const kb = !result.data.wallet
      ? BotKeyboards.walletPicker(draft.id)
      : BotKeyboards.draftConfirmation(draft.id);

    await ctx.reply(card, { parse_mode: "Markdown", reply_markup: kb });
    return;
  }

  if (result.intent === "transfer") {
    const draft = await DraftManager.createDraft(userId, "transfer", result.data);
    const card = DraftManager.formatDraftCard(draft);
    await ctx.reply(card, {
      parse_mode: "Markdown",
      reply_markup: BotKeyboards.draftConfirmation(draft.id),
    });
    return;
  }

  if (result.intent === "recap") {
    const recap = await LedgerService.getRecap({
      period: result.data.period,
      startDate: result.data.startDate,
      endDate: result.data.endDate,
      category: result.data.category,
    });
    let msg = `📊 *REKAP KEUANGAN*\n📅 Rentang: ${recap.dateRangeLabel}\n`;
    if (result.data.category) {
      msg += `🏷 Kategori: *${result.data.category}*\n`;
    }
    msg += `\n`;

    if (result.data.askBalance) {
      msg += `👛 *SALDO PER DOMPET*:\n`;
      let total = 0;
      for (const w of recap.currentWallets) {
        msg += `• ${w.name}: ${formatRupiah(w.balance)}\n`;
        total += w.balance;
      }
      msg += `👉 *Total Kas*: ${formatRupiah(total)}\n\n`;
    }

    msg += `• Total Pengeluaran: ${formatRupiah(recap.totalExpense)}\n`;
    msg += `• Total Pemasukan: ${formatRupiah(recap.totalIncome)}\n`;

    await ctx.reply(msg, { parse_mode: "Markdown" });
    return;
  }

  if (result.intent === "initial_balance") {
    const updated = await LedgerService.setInitialBalance(
      result.data.wallet,
      result.data.amount
    );
    await ctx.reply(
      `✅ Saldo awal dompet *${result.data.wallet}* berhasil diatur menjadi *${formatRupiah(
        result.data.amount
      )}*.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (result.intent === "group_log_unsupported") {
    await ctx.reply(
      "⚠️ *Perangkuman log grup membutuhkan kuota LLM.*\n" +
      "Saat ini koneksi/kuota LLM tidak tersedia. Kamu tetap bisa mencatat transaksi manual seperti _'kopi 18rb gopay'_ atau _'transfer 50k dari mandiri ke gopay'_.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Unknown message
  await ctx.reply(
    "Saya belum memahami maksud pesan ini.\n\n" +
    "Kamu bisa mengetik kalimat kasual seperti:\n" +
    "• _'kopi susu 18rb gopay'_\n" +
    "• _'makan soto 25k'_\n" +
    "• _'transfer 50rb dari mandiri ke gopay'_\n" +
    "• _'cek saldo'_ atau _'rekap minggu ini'_",
    { parse_mode: "Markdown" }
  );
}
