import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import { anonRateCounters } from "@/server/db/schema";
import { sha256Hex } from "@/server/security/hash";

export interface AnonRateStore {
  /** Atomically add 1 and return the new count. */
  increment(bucket: string, windowKey: string): Promise<number>;
}

export interface AnonLimitRule {
  /** Namespace, e.g. "register". */
  name: string;
  perIpPerHour: number;
  /** Backstop across all callers, per UTC day. */
  globalPerDay: number;
}

export interface AnonLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

/** Best-effort client IP. On Vercel the platform sets these headers, so they are not client-controlled. */
export function clientIp(req: Request): string {
  const real = req.headers.get("x-real-ip")?.trim();
  if (real) return real;
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || "unknown";
}

const hourKey = (now: Date) => `h:${now.toISOString().slice(0, 13)}`;
const dayKey = (now: Date) => `d:${now.toISOString().slice(0, 10)}`;

/** Counts one attempt. Both counters are always incremented, so a blocked caller keeps counting. */
export async function consumeAnonLimit(
  store: AnonRateStore,
  rule: AnonLimitRule,
  req: Request,
  now: Date,
): Promise<AnonLimitResult> {
  const ipBucket = `${rule.name}:ip:${sha256Hex(clientIp(req)).slice(0, 32)}`;
  const [perIp, global] = await Promise.all([
    store.increment(ipBucket, hourKey(now)),
    store.increment(`${rule.name}:all`, dayKey(now)),
  ]);
  if (perIp > rule.perIpPerHour) {
    return { allowed: false, retryAfterSeconds: 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds()) };
  }
  if (global > rule.globalPerDay) {
    const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((next - now.getTime()) / 1000)) };
  }
  return { allowed: true, retryAfterSeconds: 0 };
}

export function pgAnonRateStore(): AnonRateStore {
  return {
    async increment(bucket, windowKey) {
      const [row] = await db()
        .insert(anonRateCounters)
        .values({ bucket, windowKey, count: 1 })
        .onConflictDoUpdate({
          target: [anonRateCounters.bucket, anonRateCounters.windowKey],
          set: { count: sql`${anonRateCounters.count} + 1` },
        })
        .returning({ count: anonRateCounters.count });
      return row.count;
    },
  };
}

export const REGISTER_LIMIT: AnonLimitRule = { name: "register", perIpPerHour: 10, globalPerDay: 300 };
