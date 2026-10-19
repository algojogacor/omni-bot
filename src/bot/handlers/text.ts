import { Context, InputFile } from "grammy";
import { GroqRotator, QuotaExhaustedError } from "../../services/groq/rotator";
import { GROQ_TOOLS, buildSystemPrompt } from "../../services/groq/tools";
import { parseDeterministicMessage } from "../../services/parser/deterministic";
import { GroupLogParser } from "../../services/parser/group_log";
import { DraftManager } from "../../services/draft/manager";
import { LedgerService } from "../../services/ledger/service";
import { BotKeyboards } from "../keyboard";
import { formatRupiah, parseRupiahAmount, extractRupiahAmounts } from "../../services/ledger/math";
import { env } from "../../config/env";
import { EXPENSE_CATEGORIES } from "../../config/constants";
import { callOllamaFallback } from "../../services/ai/ollama";
import { GoogleCalendarService } from "../../services/calendar/google";

/**
 * Safely sends a message to Telegram, chunking if length exceeds 4000 characters
 * and falling back to plain text if Markdown parsing fails.
 */
export async function safeReply(ctx: Context, text: string, options?: any) {
  const MAX_CHUNK = 4000;
  if (text.length <= MAX_CHUNK) {
    try {
      return await ctx.reply(text, options);
    } catch (err: any) {
      if (options?.parse_mode) {
        console.warn(`[SafeReply] Telegram parse error (${err?.message}), falling back to plain text`);
        const fallbackOpts = { ...options };
        delete fallbackOpts.parse_mode;
        return await ctx.reply(text, fallbackOpts);
      }
      throw err;
    }
  }

  // Chunking text by paragraphs or newlines
  const chunks: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= MAX_CHUNK) {
      chunks.push(remaining);
      break;
    }
    let splitIdx = remaining.lastIndexOf("\n\n", MAX_CHUNK);
    if (splitIdx === -1 || splitIdx < 2000) {
      splitIdx = remaining.lastIndexOf("\n", MAX_CHUNK);
    }
    if (splitIdx === -1 || splitIdx < 1000) {
      splitIdx = MAX_CHUNK;
    }
    chunks.push(remaining.slice(0, splitIdx).trim());
    remaining = remaining.slice(splitIdx).trim();
  }

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const chunkOpts = i === chunks.length - 1 ? options : { parse_mode: options?.parse_mode };
    try {
      await ctx.reply(chunk, chunkOpts);
    } catch {
      const fallbackOpts = { ...chunkOpts };
      delete fallbackOpts.parse_mode;
      await ctx.reply(chunk, fallbackOpts);
    }
  }
}

const rawGroqKeys: string[] = [];
if (env.GROQ_API_KEYS) {
  rawGroqKeys.push(...env.GROQ_API_KEYS.split(",").map((k) => k.trim()).filter((k) => k.length > 0));
}
if (env.GROQ_API_KEY_PRIMARY) rawGroqKeys.push(env.GROQ_API_KEY_PRIMARY.trim());
if (env.GROQ_API_KEY_SECONDARY) rawGroqKeys.push(env.GROQ_API_KEY_SECONDARY.trim());
if (env.GROQ_API_KEY_1) rawGroqKeys.push(env.GROQ_API_KEY_1.trim());
if (env.GROQ_API_KEY_2) rawGroqKeys.push(env.GROQ_API_KEY_2.trim());

const groqKeys = Array.from(new Set(rawGroqKeys)).filter(Boolean);
let groqRotator: GroqRotator | null = null;
if (groqKeys.length > 0) {
  groqRotator = new GroqRotator({
    apiKeys: groqKeys,
    primaryModel: env.GROQ_PRIMARY_MODEL,
    fallbackModel: env.GROQ_FALLBACK_MODEL,
  });
}

export async function handleUserText(ctx: Context, text: string) {
  const userId = ctx.from?.id?.toString() || "";
  const lower = text.trim().toLowerCase();

  // 0. Check /start command
  if (lower === "/start") {
    await safeReply(
      ctx,
      "👋 *Halo Arya! Saya Omni-Bot, asisten pribadi kamu.*\n\n" +
      "Ketik apa saja secara santai tanpa perlu menghafal format perintah:\n\n" +
      "👛 *Buku Kas & Transaksi*:\n" +
      "• _'kopi susu 18rb gopay'_\n" +
      "• _'kopi 18rb, parkir 3rb, kas 20rb pake gopay'_\n" +
      "• _'keluar seratus ribu dari mandiri'_\n" +
      "• _'dapat 100rb dari mama masuk mandiri'_\n" +
      "• _'transfer 50rb dari mandiri ke gopay'_\n" +
      "• _'saldo'_ atau _'rekap bulan ini'_\n\n" +
      "📅 *Jadwal & Agenda Kalender*:\n" +
      "• _'saya lusa jam 10 ada sidang semhas'_\n" +
      "• _'besok jam 2 siang ada bimbingan di kampus'_\n" +
      "• _'apa jadwal terdekat saya?'_\n" +
      "• _'senin depan apakah ada jadwal?'_\n\n" +
      "📋 *Rangkum Obrolan Grup*:\n" +
      "• Forward/paste chat grup panjang -> TL;DR, daftar tugas, dan draf agenda ke Google Calendar.\n\n" +
      "_Semua transaksi dan agenda selalu ditampilkan sebagai draf konfirmasi terlebih dahulu sebelum disimpan._",
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

  // 2. Check if user is attempting a conversational edit or deletion on a pending draft
  const targetDraft = await DraftManager.findPendingDraftForCorrection(userId, text);
  if (targetDraft) {
    const isEditOrDeleteIntent =
      lower.includes("ganti") ||
      lower.includes("harusnya") ||
      lower.includes("bukan") ||
      lower.includes("ubah") ||
      lower.includes("koreksi") ||
      lower.includes("salah") ||
      lower.includes("hapus") ||
      lower.includes("buang") ||
      lower.includes("batal") ||
      lower.includes("tanpa") ||
      /^(tunai|gopay|mandiri)$/i.test(lower) ||
      extractRupiahAmounts(text).length > 0;

    if (isEditOrDeleteIntent) {
      const payload = JSON.parse(targetDraft.payload);
      let updated = false;

      // Check if cancellation of entire draft requested
      if (/^(batal|batalkan|hapus draf)$/i.test(lower)) {
        await DraftManager.cancelDraft(targetDraft.id);
        await safeReply(ctx, "❌ *Draf telah dibatalkan.*", { parse_mode: "Markdown" });
        return;
      }

      // Check for multi-item item deletion or modification
      if (payload.items && Array.isArray(payload.items) && payload.items.length > 0) {
        // Check deletion of a specific item: e.g. "hapus kopinya", "tanpa parkir"
        const delMatch = lower.match(/(?:hapus|buang|tanpa|batalkan|batal)\s+([a-z0-9]+)/i);
        if (delMatch && delMatch[1]) {
          const itemKey = delMatch[1].toLowerCase().replace(/nya$/, "");
          const itemIdx = payload.items.findIndex((it: any) =>
            it.description.toLowerCase().includes(itemKey)
          );
          if (itemIdx !== -1) {
            payload.items.splice(itemIdx, 1);
            updated = true;
          }
        }

        // Check modification of specific item: e.g. "yang parkir harusnya 5rb"
        for (const it of payload.items) {
          const itemKey = it.description.toLowerCase();
          if (lower.includes(itemKey)) {
            // Check new amount for this item
            const newAmtList = extractRupiahAmounts(text);
            if (newAmtList.length > 0) {
              it.amount = newAmtList[0].amount;
              updated = true;
            }
            // Check wallet for this item
            if (lower.includes("gopay")) {
              it.wallet = "GoPay";
              updated = true;
            } else if (lower.includes("mandiri")) {
              it.wallet = "Mandiri";
              updated = true;
            } else if (lower.includes("tunai")) {
              it.wallet = "Tunai";
              updated = true;
            }
          }
        }

        // Recalculate total amount
        if (updated) {
          if (payload.items.length === 0) {
            await DraftManager.cancelDraft(targetDraft.id);
            await safeReply(ctx, "❌ *Semua item dalam draf telah dihapus. Draf dibatalkan.*", {
              parse_mode: "Markdown",
            });
            return;
          }
          payload.amount = payload.items.reduce((sum: number, it: any) => sum + (it.amount || 0), 0);
        }
      }

      // Single item or general draft field edits
      if (!updated) {
        // Wallet update
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

        // Amount update
        const newAmtList = extractRupiahAmounts(text);
        if (newAmtList.length > 0) {
          payload.amount = newAmtList[0].amount;
          updated = true;
        }

        // Category update
        for (const cat of EXPENSE_CATEGORIES) {
          if (lower.includes(cat.toLowerCase())) {
            payload.category = cat;
            updated = true;
            break;
          }
        }
      }

      if (updated) {
        const revised = await DraftManager.updateDraft(targetDraft.id, payload);
        const cardText = DraftManager.formatDraftCard(revised);
        const revPayload = JSON.parse(revised.payload);
        const hasUnsetWallet = revPayload.items
          ? revPayload.items.some((i: any) => !i.wallet && !revPayload.wallet)
          : !revPayload.wallet;

        const kb = hasUnsetWallet
          ? BotKeyboards.walletPicker(revised.id)
          : BotKeyboards.draftConfirmation(revised.id);

        await safeReply(ctx, `✏️ *Draf diperbarui:*\n\n${cardText}`, {
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
      const handled = await processWithGroq(ctx, text, userId);
      if (handled) return;
    } catch (err) {
      console.warn("[TextHandler] Groq attempt failed, trying Ollama Cloud fallback:", err);
    }
  }

  // 5. Try Processing with Ollama Cloud LLM Fallback
  try {
    const ollamaResult = await callOllamaFallback(text);
    if (ollamaResult && ollamaResult.function !== "unknown") {
      const handled = await executeActionCall(ctx, userId, ollamaResult.function, ollamaResult.arguments);
      if (handled) return;
    }
  } catch (err) {
    console.warn("[TextHandler] Ollama fallback failed, falling back to deterministic mode:", err);
  }

  // 6. Deterministic Offline Parser Fallback
  await processWithDeterministic(ctx, text, userId);
}

/**
 * Handles action calls whether initiated by Groq or Ollama
 */
async function executeActionCall(
  ctx: Context,
  userId: string,
  fnName: string,
  args: any
): Promise<boolean> {
  if (fnName === "record_transaction") {
    let items = args.items;
    let totalAmount = args.amount;

    if (items && Array.isArray(items) && items.length > 0) {
      totalAmount = items.reduce((sum: number, it: any) => sum + (it.amount || 0), 0);
    }

    const draft = await DraftManager.createDraft(userId, "transaction", {
      type: args.type || "expense",
      amount: totalAmount,
      wallet: args.wallet || null,
      category: args.category || "Lainnya",
      description: args.description || (items && items.length > 0 ? "Transaksi Jamak" : "Catatan"),
      transactionDate: args.transaction_date || new Date().toISOString().slice(0, 10),
      items: items && items.length > 0 ? items : undefined,
    });

    const card = DraftManager.formatDraftCard(draft);
    const hasUnsetWallet = items && items.length > 0
      ? items.some((it: any) => !it.wallet && !args.wallet)
      : !args.wallet;

    const kb = hasUnsetWallet
      ? BotKeyboards.walletPicker(draft.id)
      : BotKeyboards.draftConfirmation(draft.id);

    await safeReply(ctx, card, { parse_mode: "Markdown", reply_markup: kb });
    return true;
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
    await safeReply(ctx, card, {
      parse_mode: "Markdown",
      reply_markup: BotKeyboards.draftConfirmation(draft.id),
    });
    return true;
  }

  if (fnName === "query_recap") {
    const recap = await LedgerService.getRecap({
      period: args.period,
      startDate: args.start_date,
      endDate: args.end_date || args.start_date,
      category: args.category,
      keyword: args.keyword,
    });

    let recapMsg = `📊 *REKAP KEUANGAN*\n`;
    recapMsg += `📅 Rentang: ${recap.dateRangeLabel}\n`;
    if (args.category) {
      recapMsg += `🏷 Kategori: *${args.category}*\n`;
    }
    if (args.keyword) {
      recapMsg += `🔍 Kata kunci: *${args.keyword}*\n`;
    }
    recapMsg += `\n`;

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
    if (recap.totalIncome > 0 || recap.totalExpense > 0) {
      recapMsg += `• Sisa Bersih: ${formatRupiah(recap.netSavings)}\n`;
    }

    if (Object.keys(recap.categoryBreakdown).length > 0) {
      recapMsg += `\n🏷 *Rincian Kategori*:\n`;
      for (const [cat, amt] of Object.entries(recap.categoryBreakdown)) {
        recapMsg += `• ${cat}: ${formatRupiah(amt)}\n`;
      }
    }

    if (recap.recentTransactions.length > 0) {
      recapMsg += `\n📝 *Daftar Transaksi*:\n`;
      for (const tx of recap.recentTransactions) {
        const sign = tx.type === "expense" ? "-" : "+";
        recapMsg += `• ${tx.description}: ${sign}${formatRupiah(tx.amount)} (${tx.walletId})\n`;
      }
      if (recap.transactionsCount > recap.recentTransactions.length) {
        recapMsg += `_...dan ${recap.transactionsCount - recap.recentTransactions.length} transaksi lainnya._\n`;
      }
    } else if (recap.totalExpense === 0 && recap.totalIncome === 0) {
      recapMsg += `\n_Belum ada transaksi yang tercatat pada rentang waktu ini._\n`;
    }

    await safeReply(ctx, recapMsg, { parse_mode: "Markdown" });
    return true;
  }

  if (fnName === "summarize_group_log") {
    const draft = await DraftManager.createDraft(userId, "group_extraction", {
      tldr: args.tldr,
      aryaTasks: args.arya_tasks || [],
      otherTasks: args.other_tasks || [],
      events: args.events || [],
    });

    const summaryCard = GroupLogParser.formatSummaryCard(args);
    await safeReply(ctx, summaryCard, { parse_mode: "Markdown" });

    // If events exist, prompt with buttons to sync to Google Calendar
    if (args.events && args.events.length > 0) {
      for (let i = 0; i < args.events.length; i++) {
        const ev = args.events[i];
        await safeReply(
          ctx,
          `📅 Draf Event #${i + 1}: *${ev.title}*\n⏰ ${ev.start_time}`,
          {
            parse_mode: "Markdown",
            reply_markup: BotKeyboards.calendarEventSync(draft.id, i),
          }
        );
      }
    }
    return true;
  }

  if (fnName === "create_schedule_event") {
    const draft = await DraftManager.createDraft(userId, "group_extraction", {
      tldr: `Jadwal: ${args.title}`,
      aryaTasks: [],
      otherTasks: [],
      events: [
        {
          title: args.title,
          start_time: args.start_time,
          end_time: args.end_time || undefined,
          description: args.description || undefined,
        },
      ],
    });

    const timeFormatted = GoogleCalendarService.formatEventTimeWIB(args.start_time, args.end_time);
    let card = `📅 *DRAF JADWAL BARU*\n\n`;
    card += `📌 *Kegiatan*: ${args.title}\n`;
    card += `⏰ *Waktu*: ${timeFormatted}\n`;
    if (args.description) {
      card += `📝 *Catatan*: ${args.description}\n`;
    }
    card += `\n_Simpan kegiatan ini ke Google Calendar kamu?_`;

    await safeReply(ctx, card, {
      parse_mode: "Markdown",
      reply_markup: BotKeyboards.calendarEventSync(draft.id, 0),
    });
    return true;
  }

  if (fnName === "query_schedule") {
    try {
      const events = await GoogleCalendarService.listEvents({
        timeMin: args.time_min || new Date().toISOString(),
        timeMax: args.time_max || undefined,
        maxResults: 10,
      });

      const label = args.label ? ` (${args.label})` : "";
      let msg = `📅 *AGENDA & JADWAL GOOGLE CALENDAR*${label}\n\n`;

      if (events.length === 0) {
        msg += `_Tidak ada jadwal atau kegiatan yang tercatat pada rentang waktu ini._\n`;
      } else {
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          const timeStr = GoogleCalendarService.formatEventTimeWIB(ev.start, ev.end);
          msg += `${i + 1}. *${ev.title}*\n`;
          msg += `   ⏰ ${timeStr}\n`;
          if (ev.description) msg += `   📝 ${ev.description}\n`;
          if (ev.htmlLink) msg += `   🔗 [Buka di Google Calendar](${ev.htmlLink})\n`;
          msg += `\n`;
        }
      }

      await safeReply(ctx, msg, { parse_mode: "Markdown" });
      return true;
    } catch (calErr: any) {
      console.error("[TextHandler] Failed to query Google Calendar:", calErr);
      await safeReply(ctx, `❌ Gagal mengambil jadwal dari Google Calendar: ${calErr.message}`);
      return true;
    }
  }

  return false;
}

/**
 * Handles message via Groq Tool Calling
 */
async function processWithGroq(ctx: Context, text: string, userId: string): Promise<boolean> {
  if (!groqRotator) return false;

  const systemPrompt = buildSystemPrompt();
  let handled = false;

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
      const recordCalls = message.tool_calls.filter(
        (c: any) => c.type === "function" && c.function.name === "record_transaction"
      );

      // If multiple record_transaction calls returned, group them into a single multi-item draft
      if (recordCalls.length > 1) {
        const combinedItems: any[] = [];
        let sharedWallet: string | null = null;
        for (const call of recordCalls) {
          const args = JSON.parse(call.function.arguments);
          if (args.wallet && !sharedWallet) sharedWallet = args.wallet;
          if (args.items && Array.isArray(args.items)) {
            combinedItems.push(...args.items);
          } else {
            combinedItems.push({
              type: args.type || "expense",
              amount: args.amount,
              wallet: args.wallet || null,
              category: args.category || "Lainnya",
              description: args.description || "Catatan",
              transaction_date: args.transaction_date || new Date().toISOString().slice(0, 10),
            });
          }
        }
        handled = await executeActionCall(ctx, userId, "record_transaction", {
          items: combinedItems,
          wallet: sharedWallet,
        });
        if (handled) return;
      }

      for (const call of message.tool_calls) {
        if (call.type !== "function") continue;
        const fnName = call.function.name;
        const args = JSON.parse(call.function.arguments);
        handled = await executeActionCall(ctx, userId, fnName, args);
        if (handled) return;
      }
    }

    // Default conversational reply if no tool was called
    if (!handled && message?.content) {
      await safeReply(ctx, message.content);
      handled = true;
    }
  });

  return handled;
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
      items: result.data.items,
    });

    const card = DraftManager.formatDraftCard(draft);
    const hasUnsetWallet = result.data.items
      ? result.data.items.some((i) => !i.wallet && !result.data.wallet)
      : !result.data.wallet;

    const kb = hasUnsetWallet
      ? BotKeyboards.walletPicker(draft.id)
      : BotKeyboards.draftConfirmation(draft.id);

    await safeReply(ctx, card, { parse_mode: "Markdown", reply_markup: kb });
    return;
  }

  if (result.intent === "transfer") {
    const draft = await DraftManager.createDraft(userId, "transfer", result.data);
    const card = DraftManager.formatDraftCard(draft);
    await safeReply(ctx, card, {
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

    await safeReply(ctx, msg, { parse_mode: "Markdown" });
    return;
  }

  if (result.intent === "schedule_query") {
    try {
      const events = await GoogleCalendarService.listEvents({
        timeMin: new Date().toISOString(),
        maxResults: 10,
      });

      let msg = `📅 *AGENDA & JADWAL GOOGLE CALENDAR* (${result.data.label})\n\n`;
      if (events.length === 0) {
        msg += `_Tidak ada jadwal atau kegiatan mendatang di Google Calendar kamu._\n`;
      } else {
        for (let i = 0; i < events.length; i++) {
          const ev = events[i];
          const timeStr = GoogleCalendarService.formatEventTimeWIB(ev.start, ev.end);
          msg += `${i + 1}. *${ev.title}*\n`;
          msg += `   ⏰ ${timeStr}\n`;
          if (ev.description) msg += `   📝 ${ev.description}\n`;
          if (ev.htmlLink) msg += `   🔗 [Buka di Google Calendar](${ev.htmlLink})\n`;
          msg += `\n`;
        }
      }

      await safeReply(ctx, msg, { parse_mode: "Markdown" });
    } catch (err: any) {
      await safeReply(ctx, `❌ Gagal mengambil jadwal dari Google Calendar: ${err.message}`);
    }
    return;
  }

  if (result.intent === "initial_balance") {
    const updated = await LedgerService.setInitialBalance(
      result.data.wallet,
      result.data.amount
    );
    await safeReply(
      ctx,
      `✅ Saldo awal dompet *${result.data.wallet}* berhasil diatur menjadi *${formatRupiah(
        result.data.amount
      )}*.`,
      { parse_mode: "Markdown" }
    );
    return;
  }

  if (result.intent === "group_log_unsupported") {
    await safeReply(
      ctx,
      "⚠️ *Perangkuman log grup membutuhkan kuota LLM.*\n" +
      "Saat ini koneksi/kuota LLM tidak tersedia. Kamu tetap bisa mencatat transaksi manual seperti _'kopi 18rb gopay'_ atau _'transfer 50k dari mandiri ke gopay'_.",
      { parse_mode: "Markdown" }
    );
    return;
  }

  // Unknown message
  await safeReply(
    ctx,
    "Saya belum memahami maksud pesan ini.\n\n" +
    "Kamu bisa mengetik kalimat kasual seperti:\n" +
    "• _'kopi susu 18rb gopay'_\n" +
    "• _'makan soto 25k'_\n" +
    "• _'transfer 50rb dari mandiri ke gopay'_\n" +
    "• _'cek saldo'_ atau _'rekap minggu ini'_",
    { parse_mode: "Markdown" }
  );
}
