import { eq, and, gte, lte, like, desc } from "drizzle-orm";
import { db } from "../../db";
import { wallets, transactions, drafts } from "../../db/schema";
import { formatRupiah, getWIBDateRange, PeriodType } from "./math";
import { WALLETS, WalletName, ExpenseCategory } from "../../config/constants";

export interface CreateTransactionParams {
  type: "expense" | "income" | "transfer";
  amount: number;
  walletId: string;
  toWalletId?: string | null;
  category?: string | null;
  description: string;
  transactionDate: string; // YYYY-MM-DD
}

export class LedgerService {
  /**
   * Retrieves all wallets with their balances
   */
  static async getWallets() {
    return await db.select().from(wallets);
  }

  /**
   * Retrieves a single wallet by ID (normalized: 'tunai', 'gopay', 'mandiri')
   */
  static normalizeWalletId(raw: string): string {
    const lower = raw.trim().toLowerCase();
    if (lower.includes("gopay") || lower.includes("go-pay")) return "gopay";
    if (lower.includes("mandiri") || lower.includes("bank")) return "mandiri";
    if (lower.includes("tunai") || lower.includes("cash")) return "tunai";
    return lower;
  }

  /**
   * Set initial balance for a wallet
   */
  static async setInitialBalance(walletRaw: string, balance: number) {
    const walletId = this.normalizeWalletId(walletRaw);
    const now = new Date().toISOString();

    await db
      .update(wallets)
      .set({ balance: Math.round(balance), updatedAt: now })
      .where(eq(wallets.id, walletId));

    return await db.select().from(wallets).where(eq(wallets.id, walletId)).get();
  }

  /**
   * Records a confirmed transaction and updates wallet balances atomically
   */
  static async recordTransaction(params: CreateTransactionParams) {
    const id = crypto.randomUUID();
    const now = new Date().toISOString();
    const amount = Math.round(params.amount);
    const walletId = this.normalizeWalletId(params.walletId);
    const toWalletId = params.toWalletId ? this.normalizeWalletId(params.toWalletId) : null;

    if (params.type === "transfer" && (!toWalletId || walletId === toWalletId)) {
      throw new Error("Transfer harus memiliki dompet asal dan tujuan yang berbeda.");
    }

    // Run transaction
    return await db.transaction(async (tx) => {
      // 1. Fetch source wallet
      const sourceWallet = await tx.select().from(wallets).where(eq(wallets.id, walletId)).get();
      if (!sourceWallet) throw new Error(`Dompet '${walletId}' tidak ditemukan.`);

      // 2. Adjust source wallet balance
      if (params.type === "expense" || params.type === "transfer") {
        await tx
          .update(wallets)
          .set({ balance: sourceWallet.balance - amount, updatedAt: now })
          .where(eq(wallets.id, walletId));
      } else if (params.type === "income") {
        await tx
          .update(wallets)
          .set({ balance: sourceWallet.balance + amount, updatedAt: now })
          .where(eq(wallets.id, walletId));
      }

      // 3. Adjust target wallet balance if transfer
      if (params.type === "transfer" && toWalletId) {
        const targetWallet = await tx.select().from(wallets).where(eq(wallets.id, toWalletId)).get();
        if (!targetWallet) throw new Error(`Dompet tujuan '${toWalletId}' tidak ditemukan.`);

        await tx
          .update(wallets)
          .set({ balance: targetWallet.balance + amount, updatedAt: now })
          .where(eq(wallets.id, toWalletId));
      }

      // 4. Insert transaction record
      await tx.insert(transactions).values({
        id,
        type: params.type,
        amount,
        walletId,
        toWalletId,
        category: params.category || "Lainnya",
        description: params.description,
        transactionDate: params.transactionDate,
        status: "confirmed",
        createdAt: now,
      });

      const updatedWallets = await tx.select().from(wallets);
      return {
        transactionId: id,
        wallets: updatedWallets,
      };
    });
  }

  /**
   * Generates financial recap strictly calculated by code
   */
  static async getRecap(options: {
    period?: PeriodType;
    startDate?: string;
    endDate?: string;
    category?: string;
    keyword?: string;
  }) {
    let startStr: string;
    let endStr: string;
    let label: string;

    if (options.period) {
      const range = getWIBDateRange(options.period);
      startStr = range.startDateString;
      endStr = range.endDateString;
      label = range.label;
    } else if (options.startDate && options.endDate) {
      startStr = options.startDate;
      endStr = options.endDate;
      label = `${startStr} sampai ${endStr}`;
    } else {
      const range = getWIBDateRange("this_month");
      startStr = range.startDateString;
      endStr = range.endDateString;
      label = range.label;
    }

    const conditions = [
      eq(transactions.status, "confirmed"),
      gte(transactions.transactionDate, startStr),
      lte(transactions.transactionDate, endStr),
    ];

    if (options.category) {
      conditions.push(eq(transactions.category, options.category));
    }
    if (options.keyword) {
      conditions.push(like(transactions.description, `%${options.keyword}%`));
    }

    const list = await db
      .select()
      .from(transactions)
      .where(and(...conditions))
      .orderBy(desc(transactions.transactionDate));

    let totalExpense = 0;
    let totalIncome = 0;
    const categoryTotals: Record<string, number> = {};

    for (const tx of list) {
      if (tx.type === "expense") {
        totalExpense += tx.amount;
        const cat = tx.category || "Lainnya";
        categoryTotals[cat] = (categoryTotals[cat] ?? 0) + tx.amount;
      } else if (tx.type === "income") {
        totalIncome += tx.amount;
      }
      // Note: transfer does NOT affect totalExpense or totalIncome!
    }

    const currentWallets = await this.getWallets();

    return {
      dateRangeLabel: label,
      startDate: startStr,
      endDate: endStr,
      totalExpense,
      totalIncome,
      netSavings: totalIncome - totalExpense,
      categoryBreakdown: categoryTotals,
      transactionsCount: list.length,
      currentWallets,
      recentTransactions: list.slice(0, 5),
    };
  }

  /**
   * Generates CSV string of all transactions for backup export
   */
  static async exportCSV(): Promise<string> {
    const list = await db
      .select()
      .from(transactions)
      .orderBy(desc(transactions.transactionDate));

    const headers = ["ID", "Tanggal", "Tipe", "Nominal", "Dompet Asal", "Dompet Tujuan", "Kategori", "Deskripsi"];
    const rows = list.map((tx) => [
      tx.id,
      tx.transactionDate,
      tx.type,
      tx.amount.toString(),
      tx.walletId,
      tx.toWalletId || "-",
      `"${(tx.category || "").replace(/"/g, '""')}"`,
      `"${tx.description.replace(/"/g, '""')}"`,
    ]);

    return [headers.join(","), ...rows.map((r) => r.join(","))].join("\n");
  }
}
