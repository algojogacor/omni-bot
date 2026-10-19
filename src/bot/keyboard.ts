import { InlineKeyboard } from "grammy";
import { WALLETS, WalletName, EXPENSE_CATEGORIES } from "../config/constants";

export class BotKeyboards {
  /**
   * Main confirmation keyboard for transactions and transfers
   */
  static draftConfirmation(draftId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text("✅ Simpan", `confirm_draft:${draftId}`)
      .text("✏️ Edit", `edit_draft:${draftId}`)
      .text("❌ Batal", `cancel_draft:${draftId}`);
  }

  /**
   * Wallet selection keyboard when wallet is omitted
   */
  static walletPicker(draftId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text("💵 Tunai", `pick_wallet:${draftId}:tunai`)
      .text("📱 GoPay", `pick_wallet:${draftId}:gopay`)
      .text("🏦 Mandiri", `pick_wallet:${draftId}:mandiri`)
      .row()
      .text("❌ Batal", `cancel_draft:${draftId}`);
  }

  /**
   * Edit draft field selection keyboard
   */
  static editFieldPicker(draftId: string): InlineKeyboard {
    return new InlineKeyboard()
      .text("💰 Ganti Nominal", `edit_field:${draftId}:amount`)
      .text("👛 Ganti Dompet", `edit_field:${draftId}:wallet`)
      .row()
      .text("🏷 Ganti Kategori", `edit_field:${draftId}:category`)
      .text("📅 Ganti Tanggal", `edit_field:${draftId}:date`)
      .row()
      .text("⬅️ Kembali ke Draf", `view_draft:${draftId}`);
  }

  /**
   * Category selection keyboard
   */
  static categoryPicker(draftId: string): InlineKeyboard {
    const kb = new InlineKeyboard();
    EXPENSE_CATEGORIES.forEach((cat, idx) => {
      kb.text(cat, `set_cat:${draftId}:${cat}`);
      if (idx % 2 === 1) kb.row();
    });
    kb.row().text("⬅️ Batal", `view_draft:${draftId}`);
    return kb;
  }

  /**
   * Calendar event sync keyboard
   */
  static calendarEventSync(draftId: string, eventIndex: number): InlineKeyboard {
    return new InlineKeyboard()
      .text("📅 Simpan ke Google Calendar", `sync_gcal:${draftId}:${eventIndex}`)
      .text("❌ Lewati", `skip_gcal:${draftId}:${eventIndex}`);
  }

  /**
   * Button on already synced calendar event allowing user to delete it from Google Calendar
   */
  static calendarEventSynced(googleEventId: string): InlineKeyboard {
    return new InlineKeyboard().text("🗑 Hapus dari Google Calendar", `del_gcal:${googleEventId}`);
  }
}
