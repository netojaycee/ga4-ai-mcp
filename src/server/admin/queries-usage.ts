import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

export const WINDOWS = [7, 14, 30] as const;
export type UsageWindow = (typeof WINDOWS)[number];
export const DEFAULT_WINDOW: UsageWindow = 14;

export function parseWindow(raw: string | string[] | undefined): UsageWindow {
  const v = Number(Array.isArray(raw) ? raw[0] : raw);
  return (WINDOWS as readonly number[]).includes(v) ? (v as UsageWindow) : DEFAULT_WINDOW;
}

/** Start of the UTC day `days - 1` days before today, so the window includes today. */
export function windowStart(days: number, now: Date): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  d.setUTCDate(d.getUTCDate() - (days - 1));
  return d;
}

type Num = number | string | null;
const n = (v: Num | undefined) => (v === null || v === undefined ? 0 : Number(v));

// Type aliases (not interfaces) so they satisfy drizzle's Record<string, unknown> row constraint.
export type RawDailyRow = { day: string; ok: Num; err: Num };
export type RawUserRow = { email: string | null; calls: Num; errors: Num };
export type RawToolRow = { tool: string; calls: Num; errors: Num; p50: Num; p95: Num };
export type RawErrorRow = { error_code: string | null; n: Num };

export interface UsageView {
  windowDays: UsageWindow;
  totals: { calls: number; errors: number; errorRate: number };
  daily: { day: string; ok: number; err: number }[];
  maxDaily: number;
  topUsers: { email: string; calls: number; errors: number }[];
  tools: { tool: string; calls: number; errors: number; errorRate: number; p50: number | null; p95: number | null }[];
  errorCodes: { code: string; count: number }[];
}

const rate = (errors: number, calls: number) => (calls === 0 ? 0 : errors / calls);
const ms = (v: Num | undefined) => (v === null || v === undefined ? null : Math.round(Number(v)));

export interface RawUsage {
  daily: RawDailyRow[];
  users: RawUserRow[];
  tools: RawToolRow[];
  errors: RawErrorRow[];
}

/** Pure mapping from query rows to the view; fills days with no events so the chart has no gaps. */
export function buildUsageView(raw: RawUsage, windowDays: UsageWindow, now: Date): UsageView {
  const byDay = new Map(raw.daily.map((r) => [r.day, r]));
  const start = windowStart(windowDays, now);
  const daily: UsageView["daily"] = [];
  for (let i = 0; i < windowDays; i++) {
    const d = new Date(start);
    d.setUTCDate(start.getUTCDate() + i);
    const key = d.toISOString().slice(0, 10);
    const r = byDay.get(key);
    daily.push({ day: key, ok: n(r?.ok), err: n(r?.err) });
  }
  const ok = daily.reduce((s, d) => s + d.ok, 0);
  const errors = daily.reduce((s, d) => s + d.err, 0);
  return {
    windowDays,
    totals: { calls: ok + errors, errors, errorRate: rate(errors, ok + errors) },
    daily,
    maxDaily: Math.max(1, ...daily.map((d) => d.ok + d.err)),
    topUsers: raw.users.map((u) => ({ email: u.email ?? "(deleted user)", calls: n(u.calls), errors: n(u.errors) })),
    tools: raw.tools.map((t) => ({
      tool: t.tool,
      calls: n(t.calls),
      errors: n(t.errors),
      errorRate: rate(n(t.errors), n(t.calls)),
      p50: ms(t.p50),
      p95: ms(t.p95),
    })),
    errorCodes: raw.errors.map((e) => ({ code: e.error_code ?? "(none)", count: n(e.n) })),
  };
}

export async function loadUsage(windowDays: UsageWindow, now = new Date()): Promise<UsageView> {
  const since = windowStart(windowDays, now);
  const d = db();
  const [daily, users, tools, errors] = await Promise.all([
    d.execute<RawDailyRow>(sql`
      select to_char((created_at at time zone 'UTC')::date, 'YYYY-MM-DD') as day,
             (count(*) filter (where ok))::int as ok,
             (count(*) filter (where not ok))::int as err
      from usage_events where created_at >= ${since}
      group by 1 order by 1`),
    d.execute<RawUserRow>(sql`
      select u.email as email, count(*)::int as calls, (count(*) filter (where not e.ok))::int as errors
      from usage_events e left join users u on u.id = e.user_id
      where e.created_at >= ${since}
      group by e.user_id, u.email order by calls desc limit 10`),
    d.execute<RawToolRow>(sql`
      select tool, count(*)::int as calls, (count(*) filter (where not ok))::int as errors,
             percentile_cont(0.5) within group (order by latency_ms) as p50,
             percentile_cont(0.95) within group (order by latency_ms) as p95
      from usage_events where created_at >= ${since}
      group by tool order by calls desc`),
    d.execute<RawErrorRow>(sql`
      select error_code, count(*)::int as n
      from usage_events where created_at >= ${since} and not ok
      group by error_code order by n desc limit 10`),
  ]);
  return buildUsageView({ daily: daily.rows, users: users.rows, tools: tools.rows, errors: errors.rows }, windowDays, now);
}
