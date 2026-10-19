import { parseRupiahAmount, extractRupiahAmounts } from "../ledger/math";
import { WalletName, ExpenseCategory, EXPENSE_CATEGORIES } from "../../config/constants";

export type DeterministicResult =
  | {
      intent: "transaction";
      data: {
        type: "expense" | "income";
        amount: number;
        wallet: WalletName | null;
        category: ExpenseCategory;
        description: string;
        transactionDate: string; // YYYY-MM-DD
        items?: Array<{
          type: "expense" | "income";
          amount: number;
          wallet: WalletName | null;
          category: ExpenseCategory;
          description: string;
          transactionDate: string;
        }>;
      };
    }
  | {
      intent: "transfer";
      data: {
        fromWallet: WalletName;
        toWallet: WalletName;
        amount: number;
        description: string;
        transactionDate: string;
      };
    }
  | {
      intent: "recap";
      data: {
        askBalance?: boolean;
        period?: "today" | "this_week" | "this_month" | "last_month";
        startDate?: string;
        endDate?: string;
        category?: ExpenseCategory;
      };
    }
  | {
      intent: "initial_balance";
      data: {
        wallet: WalletName;
        amount: number;
      };
    }
  | {
      intent: "schedule_query";
      data: {
        label: string;
      };
    }
  | {
      intent: "group_log_unsupported";
    }
  | {
      intent: "unknown";
    };

function inferCategory(text: string): ExpenseCategory {
  const lower = text.toLowerCase();
  if (
    /kopi|makan|soto|mie|sarapan|siang|malam|jajan|es|nasi|geprek|resto|warteg|bakso|burger|snack|roti|ayam/i.test(
      lower
    )
  ) {
    return "Makanan";
  }
  if (/bensin|pertalite|pertamax|gojek|grab|parkir|tol|krl|bus|ojol|angkot|maxim/i.test(lower)) {
    return "Transport";
  }
  if (/fotokopi|fotocopy|buku|print|kas|organisasi|ukm|skripsi|modul|kuliah|dosen|kampus/i.test(lower)) {
    return "Kuliah/Organisasi";
  }
  if (/listrik|pln|wifi|indihome|bpjs|pulsa|kuota|paket|sewa|kost|tagihan|air|pdam/i.test(lower)) {
    return "Tagihan";
  }
  if (/nonton|bioskop|game|steam|netflix|spotify|hiburan|karaoke|liburan/i.test(lower)) {
    return "Hiburan";
  }
  return "Lainnya";
}

function detectWallet(text: string): WalletName | null {
  const lower = text.toLowerCase();
  if (/\bgopay\b|\bgo-pay\b/i.test(lower)) return "GoPay";
  if (/\bmandiri\b|\bbank\b|\bm-banking\b|\blivin\b/i.test(lower)) return "Mandiri";
  if (/\btunai\b|\bcash\b|\buang tunai\b/i.test(lower)) return "Tunai";
  return null;
}

export function parseDeterministicMessage(rawText: string): DeterministicResult {
  const text = rawText.trim();
  const lower = text.toLowerCase();
  const today = new Date().toISOString().slice(0, 10);

  // 1. Check for group log pattern: multi-line with timestamps or multiple chat lines
  const lines = text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
  if (lines.length > 3 || /\[\d{1,2}[:/.]\d{1,2}/.test(text) || /\w+:\s+.+/m.test(text) && lines.length >= 2) {
    return { intent: "group_log_unsupported" };
  }

  // 2. Check balance query
  if (/^(cek\s+)?saldo|sisa\s+uang|uangku\s+tinggal\s+berapa$/i.test(lower)) {
    return { intent: "recap", data: { askBalance: true } };
  }

  // 3. Check recap query
  if (/\brekap\b|\bpengeluaran\b|\bpemasukan\b|\btotal\b|\bhabis\s+berapa\b|\bkeluar\s+berapa\b/i.test(lower)) {
    // Detect optional category filter (Makanan, Transport, dll.)
    const inferredCat = inferCategory(text);
    const category = inferredCat !== "Lainnya" ? inferredCat : undefined;

    // Specific date: "tanggal 15"
    const dateMatch = text.match(/tanggal\s+(\d{1,2})/i);
    if (dateMatch && dateMatch[1]) {
      const day = String(dateMatch[1]).padStart(2, "0");
      const currentYearMonth = today.slice(0, 7);
      const targetDate = `${currentYearMonth}-${day}`;
      return { intent: "recap", data: { startDate: targetDate, endDate: targetDate, category } };
    }

    // Yesterday: "kemarin"
    if (lower.includes("kemarin")) {
      const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      return { intent: "recap", data: { startDate: yesterday, endDate: yesterday, category } };
    }

    if (lower.includes("hari ini")) return { intent: "recap", data: { period: "today", category } };
    if (lower.includes("minggu ini")) return { intent: "recap", data: { period: "this_week", category } };
    if (lower.includes("bulan lalu")) return { intent: "recap", data: { period: "last_month", category } };
    if (lower.includes("bulan ini")) return { intent: "recap", data: { period: "this_month", category } };

    return { intent: "recap", data: { period: "this_month", category } };
  }

  // 4. Check schedule / calendar query
  if (/\b(jadwal|agenda|kegiatan)\b/i.test(lower)) {
    let label = "Mendatang";
    if (lower.includes("hari ini")) label = "Hari Ini";
    else if (lower.includes("besok")) label = "Besok";
    else if (lower.includes("minggu ini")) label = "Minggu Ini";
    else if (lower.includes("terdekat")) label = "Terdekat";
    return { intent: "schedule_query", data: { label } };
  }

  // 5. Check initial balance: "saldo awal tunai 100rb"
  const initMatch = lower.match(/saldo\s+awal\s+(tunai|gopay|mandiri)\s+([\d.,]+(?:\s*[a-z]+)?)/i);
  if (initMatch && initMatch[1] && initMatch[2]) {
    const wallet = detectWallet(initMatch[1]);
    const amount = parseRupiahAmount(initMatch[2]);
    if (wallet && amount !== null) {
      return {
        intent: "initial_balance",
        data: { wallet, amount },
      };
    }
  }

  // 5. Check transfer: "transfer 50rb dari mandiri ke gopay"
  const transferMatch = lower.match(
    /(?:transfer|kirim|pindah(?:kan)?|top\s*up)\s+([\d.,]+(?:\s*[a-z]+)?)\s+(?:dari\s+([a-z]+)\s+)?ke\s+([a-z]+)/i
  );
  if (transferMatch && transferMatch[1] && transferMatch[3]) {
    const amount = parseRupiahAmount(transferMatch[1]);
    const toWallet = detectWallet(transferMatch[3]);
    let fromWallet = transferMatch[2] ? detectWallet(transferMatch[2]) : null;

    if (!fromWallet && toWallet === "GoPay") fromWallet = "Mandiri"; // top up GoPay default from Mandiri
    if (!fromWallet && toWallet === "Tunai") fromWallet = "Mandiri"; // tarik tunai default from Mandiri

    if (amount !== null && fromWallet && toWallet && fromWallet !== toWallet) {
      return {
        intent: "transfer",
        data: {
          fromWallet,
          toWallet,
          amount,
          description: `Transfer dari ${fromWallet} ke ${toWallet}`,
          transactionDate: today,
        },
      };
    }
  }

  // 6. Check transaction: multi-item or single-item
  const extractedAmounts = extractRupiahAmounts(text);

  // 6a. Multi-item transaction detected: e.g. "kopi 18rb, parkir 3rb, bayar kas 20rb pake gopay"
  if (extractedAmounts.length > 1) {
    const defaultWallet = detectWallet(text);
    const clauses = text.split(/[,;\n]|\bdan\b/i).map((c) => c.trim()).filter(Boolean);
    const items: Array<{
      type: "expense" | "income";
      amount: number;
      wallet: WalletName | null;
      category: ExpenseCategory;
      description: string;
      transactionDate: string;
    }> = [];

    for (const clause of clauses) {
      const clauseAmounts = extractRupiahAmounts(clause);
      if (clauseAmounts.length === 0) continue;
      const clauseAmt = clauseAmounts[0].amount;
      const clauseWallet = detectWallet(clause) || defaultWallet;
      const isIncome = /\bdapat\b|\bterima\b|\bgaji\b|\btransferan\b|\buang saku\b|\bdikasih\b/i.test(clause);

      let desc = clause;
      if (clauseAmounts[0].raw) {
        desc = desc.replace(new RegExp(`\\b${clauseAmounts[0].raw.replace(/[.]/g, "\\.")}\\b`, "i"), "");
      }
      if (clauseWallet) {
        desc = desc.replace(new RegExp(`\\b${clauseWallet}\\b`, "i"), "");
      }
      desc = desc.replace(/\bpake\b|\bpakai\b|\bdari\b|\bke\b/gi, "").replace(/\s+/g, " ").trim();
      if (!desc) desc = isIncome ? "Pemasukan" : "Pengeluaran";

      items.push({
        type: isIncome ? "income" : "expense",
        amount: clauseAmt,
        wallet: clauseWallet,
        category: isIncome ? "Lainnya" : inferCategory(desc),
        description: desc,
        transactionDate: today,
      });
    }

    if (items.length > 0) {
      const totalAmt = items.reduce((sum, it) => sum + it.amount, 0);
      return {
        intent: "transaction",
        data: {
          type: "expense",
          amount: totalAmt,
          wallet: defaultWallet,
          category: "Lainnya",
          description: "Transaksi Jamak",
          transactionDate: today,
          items,
        },
      };
    }
  }

  // 6b. Single transaction detected: e.g. "kopi 18rb gopay", "keluar seratus ribu dari mandiri"
  if (extractedAmounts.length === 1) {
    const detectedAmount = extractedAmounts[0].amount;
    const isIncome = /\bdapat\b|\bterima\b|\bgaji\b|\btransferan\b|\buang saku\b|\bdikasih\b/i.test(lower);
    const wallet = detectWallet(text);

    let desc = text;
    if (extractedAmounts[0].raw) {
      desc = desc.replace(new RegExp(`\\b${extractedAmounts[0].raw.replace(/[.]/g, "\\.")}\\b`, "i"), "");
    }
    if (wallet) {
      desc = desc.replace(new RegExp(`\\b${wallet}\\b`, "i"), "");
    }
    desc = desc.replace(/\bpake\b|\bpakai\b|\bdari\b|\bmasuk\b|\bkeluar\b/gi, "").replace(/\s+/g, " ").trim();
    if (!desc) desc = isIncome ? "Pemasukan" : "Pengeluaran";

    const category = isIncome ? "Lainnya" : inferCategory(desc || text);

    return {
      intent: "transaction",
      data: {
        type: isIncome ? "income" : "expense",
        amount: detectedAmount,
        wallet,
        category,
        description: desc,
        transactionDate: today,
      },
    };
  }

  return { intent: "unknown" };
}
