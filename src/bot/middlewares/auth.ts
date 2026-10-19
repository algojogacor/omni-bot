import { Context, NextFunction } from "grammy";
import { env } from "../../config/env";

/**
 * Strict authentication middleware:
 * Silently drops any update from users other than ALLOWED_TELEGRAM_USER_ID.
 */
export async function authMiddleware(ctx: Context, next: NextFunction) {
  // If no allowed user ID is configured yet, log warning and ignore
  if (!env.ALLOWED_TELEGRAM_USER_ID) {
    console.warn("[AuthMiddleware] ALLOWED_TELEGRAM_USER_ID is not configured in .env. Dropping message.");
    return;
  }

  const senderId = ctx.from?.id?.toString();

  if (!senderId || senderId !== env.ALLOWED_TELEGRAM_USER_ID.trim()) {
    console.warn(`[AuthMiddleware] Unauthorized access attempt from user ID: ${senderId}. Ignored.`);
    // Silent drop: do not reply, do not process
    return;
  }

  return await next();
}
