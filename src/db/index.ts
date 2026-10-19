import { createClient } from "@libsql/client";
import { drizzle } from "drizzle-orm/libsql";
import { env } from "../config/env";
import * as schema from "./schema";

export const client = createClient({
  url: env.TURSO_DATABASE_URL,
  authToken: env.TURSO_AUTH_TOKEN,
});

export const db = drizzle(client, { schema });

/**
 * Initializes required tables and default wallets
 */
export async function initDatabase() {
  console.log(`[DB] Connecting to database at ${env.TURSO_DATABASE_URL}...`);

  // Create tables if not exist
  await client.execute(`
    CREATE TABLE IF NOT EXISTS wallets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      balance INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS transactions (
      id TEXT PRIMARY KEY,
      type TEXT NOT NULL,
      amount INTEGER NOT NULL,
      wallet_id TEXT NOT NULL REFERENCES wallets(id),
      to_wallet_id TEXT REFERENCES wallets(id),
      category TEXT,
      description TEXT NOT NULL,
      transaction_date TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'confirmed',
      created_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      telegram_message_id INTEGER,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS calendar_events (
      id TEXT PRIMARY KEY,
      draft_id TEXT REFERENCES drafts(id),
      google_event_id TEXT,
      title TEXT NOT NULL,
      description TEXT,
      start_time TEXT NOT NULL,
      end_time TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'synced',
      created_at TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS weekly_reports (
      id TEXT PRIMARY KEY,
      year_week TEXT NOT NULL UNIQUE,
      sent_at TEXT NOT NULL,
      summary_text TEXT NOT NULL
    );
  `);

  await client.execute(`
    CREATE TABLE IF NOT EXISTS processed_updates (
      update_id INTEGER PRIMARY KEY,
      processed_at TEXT NOT NULL
    );
  `);

  // Ensure initial wallets exist
  const now = new Date().toISOString();
  const defaultWallets = [
    { id: "tunai", name: "Tunai" },
    { id: "gopay", name: "GoPay" },
    { id: "mandiri", name: "Bank Mandiri" },
  ];

  for (const w of defaultWallets) {
    await client.execute({
      sql: `INSERT OR IGNORE INTO wallets (id, name, balance, updated_at) VALUES (?, ?, 0, ?)`,
      args: [w.id, w.name, now],
    });
  }

  console.log("✅ [DB] Database initialized with default wallets.");
}
