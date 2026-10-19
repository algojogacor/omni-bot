import { Bot, Context } from "grammy";
import { env } from "../config/env";
import { authMiddleware } from "./middlewares/auth";
import { dedupeMiddleware } from "./middlewares/dedupe";
import { DebounceQueue } from "./middlewares/debounce";
import { handleUserText } from "./handlers/text";
import { handleCallbackQuery } from "./handlers/callback";
import { WeeklyScheduler } from "../services/scheduler/weekly";
import { updateHealthState } from "../server/health";

export function createBot(): Bot | null {
  if (!env.TELEGRAM_BOT_TOKEN) {
    console.log("ℹ️ [Bot] TELEGRAM_BOT_TOKEN is not configured. Bot will not start polling.");
    return null;
  }

  const bot = new Bot(env.TELEGRAM_BOT_TOKEN);

  // 1. Strict Auth: Drop unauthorized messages silently
  bot.use(authMiddleware);

  // 2. Dedupe: Prevent duplicate Telegram updates
  bot.use(dedupeMiddleware);

  // 3. User Debounce Queue map (buffers messages for 1.5s)
  const userQueues = new Map<string, { queue: DebounceQueue; lastCtx: Context }>();

  // 4. Handle text messages with 1.5s debounce
  bot.on("message:text", async (ctx) => {
    const userId = ctx.from.id.toString();
    const text = ctx.message.text;

    let userEntry = userQueues.get(userId);
    if (!userEntry) {
      const queue = new DebounceQueue({
        delayMs: 1500,
        onFlush: async (combinedText) => {
          const activeCtx = userQueues.get(userId)?.lastCtx || ctx;
          updateHealthState({ lastUpdateProcessed: new Date().toISOString() });
          await handleUserText(activeCtx, combinedText);
        },
      });
      userEntry = { queue, lastCtx: ctx };
      userQueues.set(userId, userEntry);
    } else {
      userEntry.lastCtx = ctx;
    }

    userEntry.queue.push(text);
  });

  // 5. Handle inline keyboard callback queries
  bot.on("callback_query:data", async (ctx) => {
    updateHealthState({ lastUpdateProcessed: new Date().toISOString() });
    await handleCallbackQuery(ctx);
  });

  // 6. Global error boundary with alert to Arya
  bot.catch(async (err) => {
    const ctx = err.ctx;
    console.error(`[Bot] Error while handling update ${ctx.update.update_id}:`, err.error);

    if (env.ALLOWED_TELEGRAM_USER_ID) {
      try {
        const errorMsg = String((err.error as any)?.message || err.error || "Unknown error");
        await bot.api.sendMessage(
          env.ALLOWED_TELEGRAM_USER_ID,
          `⚠️ *Notifikasi Error Omni-Bot*:\n\`\`\`\n${errorMsg.slice(0, 300)}\n\`\`\``,
          { parse_mode: "Markdown" }
        );
      } catch (notifyErr) {
        console.error("[Bot] Failed to send error notification to Arya:", notifyErr);
      }
    }
  });

  return bot;
}

export async function startBot(bot: Bot) {
  console.log("🤖 [Bot] Starting long polling...");

  // Start Weekly proactive scheduler
  WeeklyScheduler.start(bot);

  // Resilient long polling loop that survives 409 conflicts and auto-reconnects
  const runPolling = async () => {
    while (true) {
      try {
        await bot.start({
          drop_pending_updates: true,
          onStart: (botInfo) => {
            console.log(`✅ [Bot] Bot running as @${botInfo.username}`);
            updateHealthState({ botRunning: true, botUsername: botInfo.username });
          },
        });
        break; // If stopped cleanly
      } catch (err: any) {
        console.warn(`[Bot] Polling loop interrupted (${err?.message || err}). Retrying in 4s...`);
        updateHealthState({ botRunning: false });
        await new Promise((res) => setTimeout(res, 4000));
      }
    }
  };

  runPolling().catch((err) => {
    console.error("[Bot] Fatal polling loop error:", err);
  });
}
