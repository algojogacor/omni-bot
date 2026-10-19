import { Context, NextFunction } from "grammy";
import { env } from "../../config/env";

/**
 * Strict authentication middleware:
 * Silently drops any update from users other than ALLOWED_TELEGRAM_USER_ID.
 */
export async function authMiddleware(ctx: Context, next: NextFunction) {
  const senderId = ctx.from?.id?.toString();

  // If no allowed user ID is configured yet, log user ID and guide the user
  if (!env.ALLOWED_TELEGRAM_USER_ID) {
    console.warn(`[AuthMiddleware] ALLOWED_TELEGRAM_USER_ID is not configured in .env. Incoming user ID: ${senderId}`);
    if (senderId) {
      await ctx.reply(
        `👋 Halo Arya!\n\nID Telegram kamu terdeteksi: <code>${senderId}</code>\n\nMasukkan ID ini ke environment variable <b>ALLOWED_TELEGRAM_USER_ID</b> agar bot terkunci aman untuk akunmu saja.`,
        { parse_mode: "HTML" }
      );
    }
    return;
  }

  if (!senderId || senderId !== env.ALLOWED_TELEGRAM_USER_ID.trim()) {
    console.warn(`[AuthMiddleware] Unauthorized access attempt from user ID: ${senderId}. Ignored.`);
    // Silent drop: do not reply, do not process
    return;
  }

  return await next();
}
