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

export const EXTREME_AMOUNT_THRESHOLD = 10_000_000; // Rp 10.000.000

/**
 * Checks whether an amount is considered unusually large (> Rp 10.000.000)
 */
export function isExtremeAmount(amount: number): boolean {
  return amount > EXTREME_AMOUNT_THRESHOLD;
}

const INDONESIAN_NUM_WORDS: Record<string, number> = {
  nol: 0,
  kosong: 0,
  satu: 1,
  se: 1,
  dua: 2,
  tiga: 3,
  empat: 4,
  lima: 5,
  enam: 6,
  tujuh: 7,
  delapan: 8,
  sembilan: 9,
  sepuluh: 10,
  sebelas: 11,
  seratus: 100,
  seribu: 1000,
  sejuta: 1000000,
};

/**
 * Parses pure Indonesian words to number (e.g. "dua ratus lima puluh ribu", "sejuta", "tiga belas ribu")
 */
export function parseIndonesianWordNumber(text: string): number | null {
  const cleaned = text.trim().toLowerCase();
  if (!cleaned) return null;

  if (cleaned === "sejuta" || cleaned === "satu juta") return 1000000;
  if (cleaned === "setengah juta") return 500000;
  if (cleaned === "seribu") return 1000;
  if (cleaned === "seratus") return 100;
  if (cleaned === "sepuluh") return 10;
  if (cleaned === "sebelas") return 11;

  // Split tokens
  const tokens = cleaned.split(/[\s-]+/).filter(Boolean);
  if (tokens.length === 0) return null;

  let total = 0;
  let currentGroup = 0;
  let currentVal = 0;
  let matchedAny = false;

  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];

    if (t === "juta") {
      matchedAny = true;
      currentGroup += currentVal;
      if (currentGroup === 0) currentGroup = 1;
      total += currentGroup * 1000000;
      currentGroup = 0;
      currentVal = 0;
    } else if (t === "ribu") {
      matchedAny = true;
      currentGroup += currentVal;
      if (currentGroup === 0) currentGroup = 1;
      total += currentGroup * 1000;
      currentGroup = 0;
      currentVal = 0;
    } else if (t === "ratus") {
      matchedAny = true;
      const multiplier = currentVal || 1;
      currentGroup += multiplier * 100;
      currentVal = 0;
    } else if (t === "puluh") {
      matchedAny = true;
      const multiplier = currentVal || 1;
      currentGroup += multiplier * 10;
      currentVal = 0;
    } else if (t === "belas") {
      matchedAny = true;
      currentGroup += (currentVal || 1) + 10;
      currentVal = 0;
    } else if (t === "setengah") {
      matchedAny = true;
      currentVal = 0.5;
    } else if (INDONESIAN_NUM_WORDS[t] !== undefined) {
      matchedAny = true;
      currentVal = INDONESIAN_NUM_WORDS[t];
    } else if (/^\d+$/.test(t)) {
      matchedAny = true;
      currentVal = parseInt(t, 10);
    } else {
      // Unrecognized word inside phrase
      return null;
    }
  }

  currentGroup += currentVal;
  total += currentGroup;

  return matchedAny && total > 0 ? Math.round(total) : null;
}

/**
 * Parses colloquial Indonesian amount strings:
 * "18k", "18rb", "18ribu", "18.000", "1,5jt", "250rb", "seratus ribu", "dua puluh lima ribu", "Rp 50.000", etc.
 */
export function parseRupiahAmount(raw: string): number | null {
  if (!raw || typeof raw !== "string") return null;

  let cleaned = raw.trim().toLowerCase();

  // Strip leading currency symbols "rp", "rp.", "idr"
  cleaned = cleaned.replace(/^(?:rp\.?|idr)\s*/i, "").trim();

  // Check word-based number directly first (e.g. "seratus ribu", "dua puluh ribu")
  const wordResult = parseIndonesianWordNumber(cleaned);
  if (wordResult !== null && wordResult > 0) {
    return wordResult;
  }

  // Remove interior spaces for shorthand forms like "50 rb", "50 k", "1.5 jt"
  const compact = cleaned.replace(/\s+/g, "");

  // Match million: "1.5jt", "1,5jt", "2jt", "1.5juta", "2juta"
  const jtMatch = compact.match(/^(\d+(?:[.,]\d+)?)(?:jt|juta)$/);
  if (jtMatch && jtMatch[1]) {
    const val = parseFloat(jtMatch[1].replace(",", "."));
    if (!isNaN(val)) return Math.round(val * 1000000);
  }

  // Match thousand: "18k", "18rb", "18ribu"
  const rbMatch = compact.match(/^(\d+(?:[.,]\d+)?)(?:k|rb|ribu)$/);
  if (rbMatch && rbMatch[1]) {
    const val = parseFloat(rbMatch[1].replace(",", "."));
    if (!isNaN(val)) return Math.round(val * 1000);
  }

  // Match formatted dots: "18.000" or raw "18000"
  const dotMatch = compact.replace(/[.]/g, "");
  if (/^\d+$/.test(dotMatch)) {
    const val = parseInt(dotMatch, 10);
    if (!isNaN(val)) return val;
  }

  return null;
}

/**
 * Finds all occurrences of Rupiah amounts in a sentence.
 * Returns an array of parsed amounts with their raw substring match.
 */
export function extractRupiahAmounts(
  text: string
): Array<{ amount: number; raw: string; start: number; end: number }> {
  const results: Array<{ amount: number; raw: string; start: number; end: number }> = [];

  // 1. Match numeric expressions: "18k", "18rb", "18.000", "Rp 50.000", "1.5jt", "25 ribu", "50 rb"
  const numRegex =
    /(?:rp\.?\s*)?(\d{1,3}(?:[.]\d{3})+(?:,\d+)?|\d+(?:[.,]\d+)?\s*(?:jt|juta|k|rb|ribu)|\b\d{3,9}\b)/gi;

  let match: RegExpExecArray | null;
  const occupiedRanges: Array<[number, number]> = [];

  while ((match = numRegex.exec(text)) !== null) {
    const raw = match[0];
    const parsed = parseRupiahAmount(raw);
    if (parsed !== null && parsed >= 100) {
      // ignore tiny numbers like single digits unless explicitly k/rb
      results.push({
        amount: parsed,
        raw,
        start: match.index,
        end: match.index + raw.length,
      });
      occupiedRanges.push([match.index, match.index + raw.length]);
    }
  }

  // 2. Match Indonesian word numbers: "seratus ribu", "dua puluh lima ribu", "sejuta", etc.
  const wordRegex =
    /\b(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|seratus|ratus|seribu|ribu|sejuta|juta|setengah)(?:\s+(?:satu|dua|tiga|empat|lima|enam|tujuh|delapan|sembilan|sepuluh|sebelas|belas|puluh|seratus|ratus|seribu|ribu|sejuta|juta|setengah))*\b/gi;

  while ((match = wordRegex.exec(text)) !== null) {
    const raw = match[0].trim();
    const start = match.index;
    const end = start + raw.length;

    // Check if overlap with numeric matches
    const overlaps = occupiedRanges.some(([s, e]) => Math.max(s, start) < Math.min(e, end));
    if (overlaps) continue;

    // Only consider as money if it contains scale words or parses to >= 500
    if (!/(?:ribu|juta|ratus|puluh|seratus|seribu|sejuta)/i.test(raw)) continue;

    const parsed = parseIndonesianWordNumber(raw);
    if (parsed !== null && parsed >= 500) {
      results.push({
        amount: parsed,
        raw,
        start,
        end,
      });
    }
  }

  return results.sort((a, b) => a.start - b.start);
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

/**
 * Formats a YYYY-MM-DD date string into an Indonesian label, e.g. "Minggu, 18 Okt 2026"
 */
export function formatWIBDateLabel(dateStr: string): string {
  const parts = dateStr.split("-").map((v) => parseInt(v, 10));
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return dateStr;
  const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  return new Intl.DateTimeFormat("id-ID", {
    timeZone: "UTC",
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(d);
}
