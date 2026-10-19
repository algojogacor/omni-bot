import { env } from "./config/env";
import { initDatabase } from "./db";
import { startHealthServer, updateHealthState } from "./server/health";
import { createBot, startBot } from "./bot/bot";

console.log("=========================================");
console.log("🚀 Omni-Bot Starting Up");
console.log(`⏱ Timezone: Asia/Jakarta`);
console.log(`⚙️ Runtime: Bun ${typeof Bun !== "undefined" ? Bun.version : process.version}`);
console.log(`🌐 Port: ${env.PORT}`);
console.log("=========================================");

async function bootstrap() {
  // 1. Initialize HTTP Health Server (serves /health immediately for Koyeb)
  startHealthServer(env.PORT);

  // 2. Initialize database connection and schemas
  try {
    await initDatabase();
  } catch (dbErr) {
    console.error("❌ [DB] Database initialization failed:", dbErr);
  }

  // 3. Initialize Telegram Bot
  const bot = createBot();
  if (bot) {
    try {
      await startBot(bot);
    } catch (botErr) {
      console.error("❌ [Bot] Failed to start bot long polling:", botErr);
      updateHealthState({ botRunning: false });
    }
  } else {
    console.log("ℹ️ [Bot] TELEGRAM_BOT_TOKEN not yet provided. Health server remains active.");
    updateHealthState({ botRunning: false });
  }
}

bootstrap().catch((err) => {
  console.error("Fatal startup error:", err);
  process.exit(1);
});
