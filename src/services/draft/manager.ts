import { eq, and, desc } from "drizzle-orm";
import { db } from "../../db";
import { drafts, calendarEvents } from "../../db/schema";
import { formatRupiah, isExtremeAmount } from "../ledger/math";
import { LedgerService } from "../ledger/service";
import { GoogleCalendarService } from "../calendar/google";

export interface TransactionItem {
  id?: string;
  type: "expense" | "income";
  amount: number;
  wallet: string | null;
  category: string;
  description: string;
  transactionDate?: string;
}

export interface TransactionDraftPayload {
  type: "expense" | "income";
  amount: number;
  wallet: string | null;
  category: string;
  description: string;
  transactionDate: string; // YYYY-MM-DD
  items?: TransactionItem[];
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

  static async getAllPendingDrafts(userId: string) {
    return await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.userId, userId), eq(drafts.status, "pending")))
      .orderBy(desc(drafts.createdAt))
      .all();
  }

  static async getLatestPendingDraft(userId: string) {
    return await db
      .select()
      .from(drafts)
      .where(and(eq(drafts.userId, userId), eq(drafts.status, "pending")))
      .orderBy(desc(drafts.createdAt))
      .get();
  }

  /**
   * Identifies which pending draft is being referenced in a conversational correction.
   */
  static async findPendingDraftForCorrection(userId: string, text: string) {
    const pending = await this.getAllPendingDrafts(userId);
    if (pending.length === 0) return null;
    if (pending.length === 1) return pending[0];

    const lower = text.toLowerCase();
    for (const d of pending) {
      try {
        const p = JSON.parse(d.payload);
        if (d.type === "transaction") {
          if (p.items && Array.isArray(p.items)) {
            for (const it of p.items) {
              if (it.description && lower.includes(it.description.toLowerCase())) {
                return d;
              }
            }
          }
          if (p.description && lower.includes(p.description.toLowerCase())) {
            return d;
          }
        }
        if (d.type === "transfer" && p.description) {
          if (lower.includes(p.description.toLowerCase())) {
            return d;
          }
        }
      } catch {}
    }

    // Default to the most recent pending draft
    return pending[0];
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

  static async deleteItem(draftId: string, itemIndex: number) {
    const draft = await this.getDraft(draftId);
    if (!draft) throw new Error("Draf tidak ditemukan.");

    const p = JSON.parse(draft.payload);
    if (!p.items || !Array.isArray(p.items) || itemIndex < 0 || itemIndex >= p.items.length) {
      throw new Error("Item tidak valid.");
    }

    p.items.splice(itemIndex, 1);
    if (p.items.length === 0) {
      await this.cancelDraft(draftId);
      return null;
    }

    p.amount = p.items.reduce((sum: number, it: any) => sum + (it.amount || 0), 0);
    return await this.updateDraft(draftId, p);
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

      if (p.items && p.items.length > 0) {
        // Multi-item transaction commit
        for (const item of p.items) {
          const itemWallet = item.wallet || p.wallet;
          if (!itemWallet) {
            throw new Error(`Pilih dompet terlebih dahulu sebelum menyimpan transaksi ('${item.description}').`);
          }

          await LedgerService.recordTransaction({
            type: item.type || p.type || "expense",
            amount: item.amount,
            walletId: itemWallet,
            category: item.category || "Lainnya",
            description: item.description,
            transactionDate: item.transactionDate || p.transactionDate,
          });
        }
      } else {
        // Single item transaction commit
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
      }
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
      const isExtreme =
        isExtremeAmount(t.amount) ||
        (t.items?.some((i) => isExtremeAmount(i.amount)) ?? false);
      const extremeWarning = isExtreme
        ? `\n\n⚠️ *Perhatian: Nominal besar (> Rp 10.000.000), mohon pastikan angka sudah sesuai!*`
        : "";

      // Multi-item card
      if (t.items && t.items.length > 1) {
        let msg = `📋 *DRAF TRANSAKSI (${t.items.length} Item)*\n\n`;
        for (let i = 0; i < t.items.length; i++) {
          const it = t.items[i];
          const sign = it.type === "income" ? "+" : "-";
          const wLabel = it.wallet || t.wallet || "⚠️ Belum dipilih";
          msg += `${i + 1}. *${it.description}*: ${sign}${formatRupiah(it.amount)} (${it.category}) [${wLabel}]\n`;
        }

        const hasUnsetWallet = t.items.some((i) => !i.wallet && !t.wallet);
        msg += `\n👉 *Total*: ${formatRupiah(t.amount)}\n`;
        msg += `👛 *Dompet*: ${t.wallet || (hasUnsetWallet ? "⚠️ _Belum semua dipilih_" : "Sesuai rincian")}\n`;
        msg += `📅 *Tanggal*: ${t.transactionDate}`;
        msg += extremeWarning;
        msg += `\n\n${
          hasUnsetWallet
            ? `_Pilih dompet melalui tombol di bawah:_`
            : `_Tekan 'Simpan' untuk konfirmasi atau balas chat ini untuk koreksi._`
        }`;
        return msg;
      }

      // Single-item card
      const typeLabel = t.type === "expense" ? "💸 Pengeluaran" : "💰 Pemasukan";
      const walletLabel = t.wallet ? `👛 ${t.wallet}` : "⚠️ *Belum dipilih* (tekan tombol di bawah)";

      return (
        `📋 *DRAF TRANSAKSI*\n\n` +
        `• *Tipe*: ${typeLabel}\n` +
        `• *Nominal*: ${formatRupiah(t.amount)}\n` +
        `• *Dompet*: ${walletLabel}\n` +
        `• *Kategori*: ${t.category}\n` +
        `• *Keterangan*: ${t.description}\n` +
        `• *Tanggal*: ${t.transactionDate}` +
        extremeWarning +
        `\n\n` +
        (t.wallet
          ? `_Tekan 'Simpan' untuk konfirmasi atau balas chat ini untuk koreksi._`
          : `_Pilih dompet yang digunakan melalui tombol di bawah:_`)
      );
    }

    if (draftRecord.type === "transfer") {
      const t = p as TransferDraftPayload;
      const isExtreme = isExtremeAmount(t.amount);
      const extremeWarning = isExtreme
        ? `\n\n⚠️ *Perhatian: Nominal besar (> Rp 10.000.000), mohon pastikan angka sudah sesuai!*`
        : "";

      return (
        `🔄 *DRAF TRANSFER DOMPET*\n\n` +
        `• *Dari Dompet*: ${t.fromWallet}\n` +
        `• *Ke Dompet*: ${t.toWallet}\n` +
        `• *Nominal*: ${formatRupiah(t.amount)}\n` +
        `• *Keterangan*: ${t.description}\n` +
        `• *Tanggal*: ${t.transactionDate}` +
        extremeWarning +
        `\n\n` +
        `_Transfer tidak mempengaruhi total saldo bersih. Tekan 'Simpan' untuk konfirmasi._`
      );
    }

    return "Draf tersimpan.";
  }
}
