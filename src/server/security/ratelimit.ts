import { and, eq, sql } from "drizzle-orm";
import type { PlanLimits } from "@/config/plans";
import { db } from "@/server/db/client";
import { rateCounters } from "@/server/db/schema";
import { ToolError } from "@/server/errors";

export interface RateLimitStore {
  /** Atomically add 1 to the counter and return the new value. */
  increment(userId: string, windowKey: string): Promise<number>;
  /** Current value without changing it (0 if absent). */
  get(userId: string, windowKey: string): Promise<number>;
}

export const minuteKey = (now: Date) => `m:${now.toISOString().slice(0, 16)}`;
export const dayKey = (now: Date) => `d:${now.toISOString().slice(0, 10)}`;

const secondsToNextMinute = (now: Date) => 60 - now.getUTCSeconds();
const secondsToNextUtcDay = (now: Date) => {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return Math.max(1, Math.ceil((next - now.getTime()) / 1000));
};

/** Counts one call against the per-minute and per-UTC-day windows; throws ToolError("rate_limited") when over. */
export async function consumeRateLimit(
  store: RateLimitStore,
  userId: string,
  limits: Pick<PlanLimits, "perMinute" | "dailyCalls">,
  now: Date,
): Promise<void> {
  const perMinute = await store.increment(userId, minuteKey(now));
  if (perMinute > limits.perMinute) {
    const s = secondsToNextMinute(now);
    throw new ToolError(
      "rate_limited",
      `Too many requests: the limit is ${limits.perMinute} tool calls per minute. Wait about ${s} second${s === 1 ? "" : "s"} and try again.`,
    );
  }
  const perDay = await store.increment(userId, dayKey(now));
  if (perDay > limits.dailyCalls) {
    const h = Math.ceil(secondsToNextUtcDay(now) / 3600);
    throw new ToolError(
      "rate_limited",
      `Daily limit reached: your plan allows ${limits.dailyCalls} tool calls per day (UTC). The counter resets at 00:00 UTC, in about ${h} hour${h === 1 ? "" : "s"}.`,
    );
  }
}

export async function dailyRemaining(
  store: RateLimitStore,
  userId: string,
  limits: Pick<PlanLimits, "dailyCalls">,
  now: Date,
): Promise<number> {
  const used = await store.get(userId, dayKey(now));
  return Math.max(0, limits.dailyCalls - used);
}

/** Postgres store: one atomic upsert-increment per window. */
export function pgRateLimitStore(): RateLimitStore {
  return {
    async increment(userId, windowKey) {
      const [row] = await db()
        .insert(rateCounters)
        .values({ userId, windowKey, count: 1 })
        .onConflictDoUpdate({
          target: [rateCounters.userId, rateCounters.windowKey],
          set: { count: sql`${rateCounters.count} + 1` },
        })
        .returning({ count: rateCounters.count });
      return row.count;
    },
    async get(userId, windowKey) {
      const rows = await db()
        .select({ count: rateCounters.count })
        .from(rateCounters)
        .where(and(eq(rateCounters.userId, userId), eq(rateCounters.windowKey, windowKey)));
      return rows[0]?.count ?? 0;
    },
  };
}
