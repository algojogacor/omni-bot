import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";

export const wallets = sqliteTable("wallets", {
  id: text("id").primaryKey(), // 'tunai' | 'gopay' | 'mandiri'
  name: text("name").notNull(), // 'Tunai' | 'GoPay' | 'Mandiri'
  balance: integer("balance").notNull().default(0), // Integer Rupiah
  updatedAt: text("updated_at").notNull(),
});

export const transactions = sqliteTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type", { enum: ["expense", "income", "transfer"] }).notNull(),
  amount: integer("amount").notNull(), // Integer Rupiah
  walletId: text("wallet_id").notNull().references(() => wallets.id),
  toWalletId: text("to_wallet_id").references(() => wallets.id),
  category: text("category"), // Makanan, Transport, etc.
  description: text("description").notNull(),
  transactionDate: text("transaction_date").notNull(), // YYYY-MM-DD or ISO string in WIB
  status: text("status", { enum: ["confirmed", "cancelled"] }).notNull().default("confirmed"),
  createdAt: text("created_at").notNull(),
});

export const drafts = sqliteTable("drafts", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type", { enum: ["transaction", "transfer", "calendar_event", "group_extraction"] }).notNull(),
  payload: text("payload").notNull(), // JSON string
  status: text("status", { enum: ["pending", "approved", "rejected", "superseded"] }).notNull().default("pending"),
  telegramMessageId: integer("telegram_message_id"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
});

export const calendarEvents = sqliteTable("calendar_events", {
  id: text("id").primaryKey(),
  draftId: text("draft_id").references(() => drafts.id),
  googleEventId: text("google_event_id"),
  title: text("title").notNull(),
  description: text("description"),
  startTime: text("start_time").notNull(), // ISO string in WIB
  endTime: text("end_time").notNull(),     // ISO string in WIB
  status: text("status", { enum: ["synced", "deleted"] }).notNull().default("synced"),
  createdAt: text("created_at").notNull(),
});

export const weeklyReports = sqliteTable("weekly_reports", {
  id: text("id").primaryKey(),
  yearWeek: text("year_week").notNull().unique(), // e.g. "2026-W42"
  sentAt: text("sent_at").notNull(),
  summaryText: text("summary_text").notNull(),
});

export const processedUpdates = sqliteTable("processed_updates", {
  updateId: integer("update_id").primaryKey(),
  processedAt: text("processed_at").notNull(),
});
