import { Context, NextFunction } from "grammy";
import { db } from "../../db";
import { processedUpdates } from "../../db/schema";
import { eq } from "drizzle-orm";

const memoryCache = new Set<number>();
const MAX_CACHE_SIZE = 5000;

export async function dedupeMiddleware(ctx: Context, next: NextFunction) {
  const updateId = ctx.update.update_id;

  // 1. Fast in-memory check
  if (memoryCache.has(updateId)) {
    console.log(`[Dedupe] Duplicate update ${updateId} detected in memory cache. Dropping.`);
    return;
  }

  // 2. Persistent check in database
  try {
    const existing = await db
      .select()
      .from(processedUpdates)
      .where(eq(processedUpdates.updateId, updateId))
      .get();

    if (existing) {
      memoryCache.add(updateId);
      console.log(`[Dedupe] Duplicate update ${updateId} detected in database. Dropping.`);
      return;
    }

    // 3. Insert into database and memory cache
    await db.insert(processedUpdates).values({
      updateId,
      processedAt: new Date().toISOString(),
    });

    memoryCache.add(updateId);
    if (memoryCache.size > MAX_CACHE_SIZE) {
      const first = memoryCache.values().next().value;
      if (first !== undefined) memoryCache.delete(first);
    }
  } catch (err) {
    console.warn(`[Dedupe] Database check failed, proceeding with in-memory check:`, err);
    memoryCache.add(updateId);
  }

  return await next();
}
