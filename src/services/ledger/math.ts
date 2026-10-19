import { TIMEZONE } from "../../config/constants";

/**
 * Formats an integer amount in Rupiah (e.g. 18000 -> "Rp18.000", -25000 -> "-Rp25.000")
 */
export function formatRupiah(amount: number): string {
  const isNegative = amount < 0;
  const abs = Math.abs(Math.round(amount));
  const formatted = abs.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return isNegative ? `-Rp${formatted}` : `Rp${formatted}`;
}

/**
 * Parses colloquial Indonesian amount strings:
 * "18k", "18rb", "18ribu", "18.000", "1,5jt", "250rb", etc.
 */
export function parseRupiahAmount(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;

  let cleaned = raw.trim().toLowerCase().replace(/\s+/g, "");

  // Match million: "1.5jt", "1,5jt", "2jt", "1.5juta"
  const jtMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)(?:jt|juta)$/);
  if (jtMatch && jtMatch[1]) {
    const val = parseFloat(jtMatch[1].replace(",", "."));
    if (!isNaN(val)) return Math.round(val * 1000000);
  }

  // Match thousand: "18k", "18rb", "18ribu"
  const rbMatch = cleaned.match(/^(\d+(?:[.,]\d+)?)(?:k|rb|ribu)$/);
  if (rbMatch && rbMatch[1]) {
    const val = parseFloat(rbMatch[1].replace(",", "."));
    if (!isNaN(val)) return Math.round(val * 1000);
  }

  // Match formatted dots: "18.000" or raw "18000"
  const dotMatch = cleaned.replace(/[.]/g, "");
  if (/^\d+$/.test(dotMatch)) {
    const val = parseInt(dotMatch, 10);
    if (!isNaN(val)) return val;
  }

  return null;
}

/**
 * Pure function: calculates new wallet balances given initial balances and a list of transactions
 */
export function computeBalancesFromTransactions(
  initialWallets: Record<string, number>,
  txs: Array<{
    type: "expense" | "income" | "transfer";
    amount: number;
    walletId: string;
    toWalletId?: string | null;
  }>
): Record<string, number> {
  const balances = { ...initialWallets };

  for (const tx of txs) {
    const amt = Math.round(tx.amount);
    if (tx.type === "expense") {
      balances[tx.walletId] = (balances[tx.walletId] ?? 0) - amt;
    } else if (tx.type === "income") {
      balances[tx.walletId] = (balances[tx.walletId] ?? 0) + amt;
    } else if (tx.type === "transfer" && tx.toWalletId) {
      balances[tx.walletId] = (balances[tx.walletId] ?? 0) - amt;
      balances[tx.toWalletId] = (balances[tx.toWalletId] ?? 0) + amt;
    }
  }

  return balances;
}

export type PeriodType = "today" | "this_week" | "this_month" | "last_month";

export interface DateRangeResult {
  startDateString: string; // YYYY-MM-DD
  endDateString: string;   // YYYY-MM-DD
  label: string;           // E.g. "Senin, 19 Okt 2026 sampai Minggu, 25 Okt 2026"
}

/**
 * Returns date range boundaries for Asia/Jakarta (WIB)
 */
export function getWIBDateRange(period: PeriodType, referenceDate = new Date()): DateRangeResult {
  // Convert referenceDate to WIB components
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  });

  const parts = formatter.formatToParts(referenceDate);
  const getPart = (type: string) => parts.find((p) => p.type === type)?.value || "";

  const y = parseInt(getPart("year"), 10);
  const m = parseInt(getPart("month"), 10) - 1; // 0-indexed
  const d = parseInt(getPart("day"), 10);

  // Construct local date representing WIB date
  const wibDate = new Date(Date.UTC(y, m, d));

  let start: Date;
  let end: Date;

  if (period === "today") {
    start = new Date(Date.UTC(y, m, d));
    end = new Date(Date.UTC(y, m, d));
  } else if (period === "this_week") {
    // Indonesian week starts Monday (day 1). JS getUTCDay: 0=Sun, 1=Mon, ..., 6=Sat
    const dayOfWeek = wibDate.getUTCDay();
    const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    start = new Date(Date.UTC(y, m, d + diffToMonday));
    end = new Date(Date.UTC(y, m, d + diffToMonday + 6));
  } else if (period === "this_month") {
    start = new Date(Date.UTC(y, m, 1));
    end = new Date(Date.UTC(y, m + 1, 0)); // last day of current month
  } else {
    // last_month
    start = new Date(Date.UTC(y, m - 1, 1));
    end = new Date(Date.UTC(y, m, 0)); // last day of previous month
  }

  const toDateStr = (date: Date) => {
    const yr = date.getUTCFullYear();
    const mo = String(date.getUTCMonth() + 1).padStart(2, "0");
    const da = String(date.getUTCDate()).padStart(2, "0");
    return `${yr}-${mo}-${da}`;
  };

  const toLabel = (date: Date) => {
    return new Intl.DateTimeFormat("id-ID", {
      timeZone: "UTC",
      weekday: "long",
      day: "numeric",
      month: "short",
      year: "numeric",
    }).format(date);
  };

  const startStr = toDateStr(start);
  const endStr = toDateStr(end);

  const label =
    startStr === endStr
      ? toLabel(start)
      : `${toLabel(start)} sampai ${toLabel(end)}`;

  return {
    startDateString: startStr,
    endDateString: endStr,
    label,
  };
}
