import { parseRupiahAmount } from "../ledger/math";
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
  if (/\brekap\b|\bpengeluaran\b|\bpemasukan\b/i.test(lower)) {
    if (lower.includes("hari ini")) return { intent: "recap", data: { period: "today" } };
    if (lower.includes("minggu ini")) return { intent: "recap", data: { period: "this_week" } };
    if (lower.includes("bulan lalu")) return { intent: "recap", data: { period: "last_month" } };
    if (lower.includes("bulan ini")) return { intent: "recap", data: { period: "this_month" } };
    return { intent: "recap", data: { period: "this_month" } };
  }

  // 4. Check initial balance: "saldo awal tunai 100rb"
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

  // 6. Check transaction: "kopi 18rb gopay", "makan siang 25k tunai", "dapat 50k dari mama masuk bank"
  const words = text.split(/\s+/);
  let detectedAmount: number | null = null;
  let amountWord = "";

  for (const w of words) {
    const parsed = parseRupiahAmount(w);
    if (parsed !== null && parsed > 0) {
      detectedAmount = parsed;
      amountWord = w;
      break;
    }
  }

  if (detectedAmount !== null) {
    const isIncome = /\bdapat\b|\bterima\b|\bgaji\b|\btransferan\b|\buang saku\b|\bdikasih\b/i.test(lower);
    const wallet = detectWallet(text);

    // Clean description by removing amount and wallet word
    let desc = text;
    if (amountWord) {
      desc = desc.replace(new RegExp(`\\b${amountWord.replace(/[.]/g, "\\.")}\\b`, "i"), "");
    }
    if (wallet) {
      desc = desc.replace(new RegExp(`\\b${wallet}\\b`, "i"), "");
    }
    desc = desc.replace(/\s+/g, " ").trim();
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
