import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { drafts, calendarEvents } from "../../db/schema";
import { formatRupiah } from "../ledger/math";
import { LedgerService } from "../ledger/service";
import { GoogleCalendarService } from "../calendar/google";

export interface TransactionDraftPayload {
  type: "expense" | "income";
  amount: number;
  wallet: string | null;
  category: string;
  description: string;
  transactionDate: string; // YYYY-MM-DD
}

export interface TransferDraftPayload {
  fromWallet: string;
  toWallet: string;
  amount: number;
  description: string;
  transactionDate: string;
}

export interface GroupSummaryDraftPayload {
  tldr: string;
  aryaTasks: string[];
  otherTasks: Array<{ person: string; task: string }>;
  events: Array<{
    title: string;
    startTime: string;
    endTime?: string;
    description?: string;
    synced?: boolean;
    googleEventId?: string;
  }>;
}

export class DraftManager {
  static async createDraft(
    userId: string,
    type: "transaction" | "transfer" | "calendar_event" | "group_extraction",
    payload: any,
    messageId?: number
  ) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();

    await db.insert(drafts).values({
      id,
      userId,
      type,
      payload: JSON.stringify(payload),
      status: "pending",
      telegramMessageId: messageId || null,
      createdAt: now,
      updatedAt: now,
    });

    return await this.getDraft(id);
  }

  static async getDraft(draftId: string) {
    return await db.select().from(drafts).where(eq(drafts.id, draftId)).get();
  }

  static async getLatestPendingDraft(userId: string) {
    return await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.userId, userId), eq(drafts.status, "pending")))
      .orderBy(desc(drafts.createdAt))
      .get();
  }

  static async updateDraft(draftId: string, partialPayload: any) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error("Draf tidak ditemukan.");

    const current = JSON.parse(draft.payload);
    const updated = { ...current, ...partialPayload };
    const now = new Date().toISOString();

    await db
      .update(drafts)
      .set({
        payload: JSON.stringify(updated),
        updatedAt: now,
      })
      .where(eq(drafts.id, draftId));

    return await this.getDraft(draftId);
  }

  static async cancelDraft(draftId: string) {
    const now = new Date().toISOString();
    await db
      .update(drafts)
      .set({ status: "rejected", updatedAt: now })
      .where(eq(drafts.id, draftId));
  }

  static async commitDraft(draftId: string) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error("Draf tidak ditemukan.");
    if (draft.status !== "pending") throw new Error(`Draf sudah berstatus '${draft.status}'.`);

    const payload = JSON.parse(draft.payload);

    if (draft.type === "transaction") {
      const p = payload as TransactionDraftPayload;
      if (!p.wallet) {
        throw new Error("Pilih dompet terlebih dahulu sebelum menyimpan transaksi.");
      }

      await LedgerService.recordTransaction({
        type: p.type,
        amount: p.amount,
        walletId: p.wallet,
        category: p.category,
        description: p.description,
        transactionDate: p.transactionDate,
      });
    } else if (draft.type === "transfer") {
      const p = payload as TransferDraftPayload;
      await LedgerService.recordTransaction({
        type: "transfer",
        amount: p.amount,
        walletId: p.fromWallet,
        toWalletId: p.toWallet,
        description: p.description,
        transactionDate: p.transactionDate,
      });
    }

    const now = new Date().toISOString();
    await db
      .update(drafts)
      .set({ status: "approved", updatedAt: now })
      .where(eq(drafts.id, draftId));

    return await LedgerService.getWallets();
  }

  /**
   * Formats a draft for Telegram message
   */
  static formatDraftCard(draftRecord: any): string {
    const p = JSON.parse(draftRecord.payload);

    if (draftRecord.type === "transaction") {
      const t = p as TransactionDraftPayload;
      const typeLabel = t.type === "expense" ? "💸 Pengeluaran" : "💰 Pemasukan";
      const walletLabel = t.wallet ? `👛 ${t.wallet}` : "⚠️ *Belum dipilih* (tekan tombol di bawah)";

      return (
        `📋 *DRAF TRANSAKSI*\n\n` +
        `• *Tipe*: ${typeLabel}\n` +
        `• *Nominal*: ${formatRupiah(t.amount)}\n` +
        `• *Dompet*: ${walletLabel}\n` +
        `• *Kategori*: ${t.category}\n` +
        `• *Keterangan*: ${t.description}\n` +
        `• *Tanggal*: ${t.transactionDate}\n\n` +
        (t.wallet
          ? `_Tekan 'Simpan' untuk konfirmasi atau balas chat ini untuk koreksi._`
          : `_Pilih dompet yang digunakan melalui tombol di bawah:_`)
      );
    }

    if (draftRecord.type === "transfer") {
      const t = p as TransferDraftPayload;
      return (
        `🔄 *DRAF TRANSFER DOMPET*\n\n` +
        `• *Dari Dompet*: ${t.fromWallet}\n` +
        `• *Ke Dompet*: ${t.toWallet}\n` +
        `• *Nominal*: ${formatRupiah(t.amount)}\n` +
        `• *Keterangan*: ${t.description}\n` +
        `• *Tanggal*: ${t.transactionDate}\n\n` +
        `_Transfer tidak mempengaruhi total saldo bersih. Tekan 'Simpan' untuk konfirmasi._`
      );
    }

    return "Draf tersimpan.";
  }
}
