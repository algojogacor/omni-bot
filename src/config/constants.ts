export const TIMEZONE = "Asia/Jakarta";

export const WALLETS = ["Tunai", "GoPay", "Mandiri"] as const;
export type WalletName = (typeof WALLETS)[number];

export const EXPENSE_CATEGORIES = [
  "Makanan",
  "Transport",
  "Kuliah/Organisasi",
  "Hiburan",
  "Tagihan",
  "Lainnya",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

export const TRANSACTION_TYPES = ["expense", "income", "transfer"] as const;
export type TransactionType = (typeof TRANSACTION_TYPES)[number];

export const DRAFT_STATUSES = ["pending", "approved", "rejected", "superseded"] as const;
export type DraftStatus = (typeof DRAFT_STATUSES)[number];

export const DEFAULT_EVENT_DURATION_MINUTES = 60;
export const DEFAULT_TASK_DEADLINE_DURATION_MINUTES = 30;
export const MAX_GROUP_LOG_ESTIMATED_TOKENS = 3000;
export const DEBOUNCE_WAIT_MS = 1500;
