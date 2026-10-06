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

export interface ClientIpOptions {
  /** True only where a trusted platform overwrites `x-real-ip` (Vercel). Elsewhere clients can set it themselves. */
  trustRealIp?: boolean;
}

/**
 * Best-effort client IP for throttling.
 * - Vercel overwrites x-real-ip and x-forwarded-for, so they are trustworthy there.
 * - Anywhere else, the LEFT side of x-forwarded-for is attacker-controlled; the RIGHTMOST entry is the one our own
 *   reverse proxy appended. Use that (assumes exactly one trusted proxy in front).
 * - No usable header: everyone shares the "unknown" bucket (fails safe: stricter, not looser).
 */
export function clientIp(req: Request, opts: ClientIpOptions = {}): string {
  const trustRealIp = opts.trustRealIp ?? Boolean(process.env.VERCEL);
  if (trustRealIp) {
    const real = req.headers.get("x-real-ip")?.trim();
    if (real) return real;
  }
  const parts = req.headers.get("x-forwarded-for")?.split(",").map((p) => p.trim()).filter(Boolean) ?? [];
  return parts.at(-1) ?? "unknown";
}

const hourKey = (now: Date) => `h:${now.toISOString().slice(0, 13)}`;
const dayKey = (now: Date) => `d:${now.toISOString().slice(0, 10)}`;

/**
 * Counts one attempt. The per-IP counter always counts. The global counter only counts attempts that passed the
 * per-IP check, so one abusive source cannot burn the shared daily budget and lock everyone else out.
 */
export async function consumeAnonLimit(
  store: AnonRateStore,
  rule: AnonLimitRule,
  req: Request,
  now: Date,
  ipOpts?: ClientIpOptions,
): Promise<AnonLimitResult> {
  const ipBucket = `${rule.name}:ip:${sha256Hex(clientIp(req, ipOpts)).slice(0, 32)}`;
  const perIp = await store.increment(ipBucket, hourKey(now));
  if (perIp > rule.perIpPerHour) {
    return { allowed: false, retryAfterSeconds: 3600 - (now.getUTCMinutes() * 60 + now.getUTCSeconds()) };
  }
  const global = await store.increment(`${rule.name}:all`, dayKey(now));
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

export const REGISTER_LIMIT: AnonLimitRule = { name: "register", perIpPerHour: 10, globalPerDay: 1000 };

/** Requests to /mcp with a missing or invalid token. Each costs a DB lookup, so cap per source; the global cap is a backstop only. */
export const MCP_AUTH_FAIL_LIMIT: AnonLimitRule = { name: "mcp-auth-fail", perIpPerHour: 300, globalPerDay: 200_000 };
