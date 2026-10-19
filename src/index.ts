import { env } from "./config/env";
import { startHealthServer, updateHealthState } from "./server/health";

console.log("=========================================");
console.log("🚀 Omni-Bot Starting Up");
console.log(`⏱ Timezone: Asia/Jakarta`);
console.log(`⚙️ Runtime: Bun ${typeof Bun !== "undefined" ? Bun.version : process.version}`);
console.log(`🌐 Port: ${env.PORT}`);
console.log("=========================================");

// 1. Start HTTP Health Server (critical for Koyeb healthcheck)
startHealthServer(env.PORT);

// 2. Telegram Bot initialization (will attach in subsequent tasks when token is configured)
if (!env.TELEGRAM_BOT_TOKEN) {
  console.log("ℹ️ TELEGRAM_BOT_TOKEN not yet provided. Health server is active and responding on /health.");
  updateHealthState({ botRunning: false });
} else {
  console.log("🤖 Initializing Telegram bot long polling...");
  updateHealthState({ botRunning: true });
}
