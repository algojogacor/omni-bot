import { Context } from "grammy";
import { DraftManager } from "../../services/draft/manager";
import { GoogleCalendarService } from "../../services/calendar/google";
import { BotKeyboards } from "../keyboard";
import { formatRupiah } from "../../services/ledger/math";
import { db } from "../../db";
import { calendarEvents } from "../../db/schema";
import { eq } from "drizzle-orm";

export async function handleCallbackQuery(ctx: Context) {
  const data = ctx.callbackQuery?.data;
  if (!data) return;

  await ctx.answerCallbackQuery(); // acknowledge callback immediately

  const parts = data.split(":");
  const action = parts[0];
  const draftId = parts[1];

  // 1. Confirm draft (Save to DB)
  if (action === "confirm_draft" && draftId) {
    try {
      const updatedWallets = await DraftManager.commitDraft(draftId);

      let successMsg = `✅ *Catatan berhasil disimpan ke buku kas!*\n\n`;
      successMsg += `👛 *Saldo Terbaru*:\n`;
      for (const w of updatedWallets) {
        successMsg += `• ${w.name}: ${formatRupiah(w.balance)}\n`;
      }

      await ctx.editMessageText(successMsg, { parse_mode: "Markdown" });
    } catch (err: any) {
      await ctx.reply(`❌ Gagal menyimpan draf: ${err.message}`);
    }
    return;
  }

  // 2. Cancel draft
  if (action === "cancel_draft" && draftId) {
    await DraftManager.cancelDraft(draftId);
    await ctx.editMessageText("❌ *Draf telah dibatalkan.*", { parse_mode: "Markdown" });
    return;
  }

  // 3. Pick Wallet
  if (action === "pick_wallet" && draftId && parts[2]) {
    const rawWallet = parts[2];
    const walletMap: Record<string, string> = {
      tunai: "Tunai",
      gopay: "GoPay",
      mandiri: "Mandiri",
    };
    const walletName = walletMap[rawWallet] || "Tunai";

    const updated = await DraftManager.updateDraft(draftId, { wallet: walletName });
    const cardText = DraftManager.formatDraftCard(updated);

    await ctx.editMessageText(cardText, {
      parse_mode: "Markdown",
      reply_markup: BotKeyboards.draftConfirmation(draftId),
    });
    return;
  }

  // 4. Edit draft menu
  if (action === "edit_draft" && draftId) {
    await ctx.editMessageReplyMarkup({
      reply_markup: BotKeyboards.editFieldPicker(draftId),
    });
    return;
  }

  // 5. View draft (back button)
  if (action === "view_draft" && draftId) {
    const draft = await DraftManager.getDraft(draftId);
    if (!draft) return;
    const cardText = DraftManager.formatDraftCard(draft);
    await ctx.editMessageText(cardText, {
      parse_mode: "Markdown",
      reply_markup: BotKeyboards.draftConfirmation(draftId),
    });
    return;
  }

  // 6. Edit Field
  if (action === "edit_field" && draftId && parts[2]) {
    const field = parts[2];
    if (field === "category") {
      await ctx.editMessageReplyMarkup({
        reply_markup: BotKeyboards.categoryPicker(draftId),
      });
      return;
    }

    if (field === "wallet") {
      await ctx.editMessageReplyMarkup({
        reply_markup: BotKeyboards.walletPicker(draftId),
      });
      return;
    }

    if (field === "amount" || field === "date") {
      await ctx.reply(
        `Silakan ketik ${field === "amount" ? "nominal baru (misal: '25rb')" : "tanggal baru (misal: '2026-10-20')"} langsung di chat.`
      );
      return;
    }
  }

  // 7. Set Category
  if (action === "set_cat" && draftId && parts[2]) {
    const newCategory = parts[2];
    const updated = await DraftManager.updateDraft(draftId, { category: newCategory });
    const cardText = DraftManager.formatDraftCard(updated);
    await ctx.editMessageText(cardText, {
      parse_mode: "Markdown",
      reply_markup: BotKeyboards.draftConfirmation(draftId),
    });
    return;
  }

  // 8. Sync Event to Google Calendar
  if (action === "sync_gcal" && draftId && parts[2] !== undefined) {
    const eventIndex = parseInt(parts[2], 10);
    const draft = await DraftManager.getDraft(draftId);
    if (!draft) return;

    const payload = JSON.parse(draft.payload);
    const ev = payload.events?.[eventIndex];
    if (!ev) {
      await ctx.reply("❌ Event tidak ditemukan.");
      return;
    }

    try {
      const gcalResult = await GoogleCalendarService.createEvent({
        title: ev.title,
        startTime: ev.start_time || ev.startTime,
        endTime: ev.end_time || ev.endTime,
        description: ev.description,
      });

      // Persist in calendar_events table
      await db.insert(calendarEvents).values({
        id: crypto.randomUUID(),
        draftId,
        googleEventId: gcalResult.eventId,
        title: ev.title,
        description: ev.description || null,
        startTime: gcalResult.startTime,
        endTime: gcalResult.endTime,
        status: "synced",
        createdAt: new Date().toISOString(),
      });

      let syncMsg = `✅ *Tersimpan di Google Calendar!*\n\n`;
      syncMsg += `📌 *${ev.title}*\n`;
      syncMsg += `⏰ ${ev.start_time || ev.startTime}\n`;
      if (gcalResult.htmlLink) {
        syncMsg += `🔗 [Buka di Google Calendar](${gcalResult.htmlLink})\n`;
      }

      await ctx.editMessageText(syncMsg, {
        parse_mode: "Markdown",
        reply_markup: BotKeyboards.calendarEventSynced(gcalResult.eventId),
      });
    } catch (err: any) {
      console.error("[GCal] Sync error:", err);
      await ctx.reply(`❌ Gagal menyinkronkan ke Google Calendar: ${err.message}`);
    }
    return;
  }

  // 9. Skip Calendar Event
  if (action === "skip_gcal") {
    await ctx.editMessageText("❌ *Event dilewati.*", { parse_mode: "Markdown" });
    return;
  }

  // 10. Delete Event from Google Calendar
  if (action === "del_gcal" && parts[1]) {
    const googleEventId = parts[1];
    try {
      await GoogleCalendarService.deleteEvent(googleEventId);
      await db
        .update(calendarEvents)
        .set({ status: "deleted" })
        .where(eq(calendarEvents.googleEventId, googleEventId));

      await ctx.editMessageText("🗑 *Event telah dihapus dari Google Calendar.*", {
        parse_mode: "Markdown",
      });
    } catch (err: any) {
      await ctx.reply(`❌ Gagal menghapus event: ${err.message}`);
    }
    return;
  }
}
