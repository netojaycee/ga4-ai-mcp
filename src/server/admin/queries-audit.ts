import { and, desc, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";

export const AUDIT_PAGE_SIZE = 50;
const MAX_PAGE = 10_000;

export interface AuditFilter {
  prefix: string;
  actor: string;
  page: number;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

export function parseAuditFilter(sp: Record<string, string | string[] | undefined>): AuditFilter {
  const page = Math.floor(Number(first(sp.page)));
  return {
    prefix: first(sp.prefix).trim().slice(0, 100),
    actor: first(sp.actor).trim().slice(0, 200),
    page: Number.isFinite(page) && page >= 1 ? Math.min(page, MAX_PAGE) : 1,
  };
}

/** Escape LIKE wildcards so user input is matched literally. */
export const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

export interface AuditQueryPlan {
  /** Pattern for `action LIKE ... ESCAPE '\'`, or null. */
  actionPattern: string | null;
  /** Pattern for `actor ILIKE ... ESCAPE '\'`, or null. */
  actorPattern: string | null;
  limit: number;
  offset: number;
}

export function planAuditQuery(f: AuditFilter): AuditQueryPlan {
  return {
    actionPattern: f.prefix ? `${escapeLike(f.prefix)}%` : null,
    actorPattern: f.actor ? `%${escapeLike(f.actor)}%` : null,
    // One extra row tells us whether a next page exists.
    limit: AUDIT_PAGE_SIZE + 1,
    offset: (f.page - 1) * AUDIT_PAGE_SIZE,
  };
}

export interface AuditRow {
  id: number;
  actor: string;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  createdAt: Date;
}

export interface AuditPage {
  rows: AuditRow[];
  hasNext: boolean;
  page: number;
}

export function toAuditPage(rows: AuditRow[], page: number): AuditPage {
  return { rows: rows.slice(0, AUDIT_PAGE_SIZE), hasNext: rows.length > AUDIT_PAGE_SIZE, page };
}

export async function loadAudit(filter: AuditFilter): Promise<AuditPage> {
  const plan = planAuditQuery(filter);
  const conds: SQL[] = [];
  if (plan.actionPattern) conds.push(sql`${auditLog.action} like ${plan.actionPattern} escape '\\'`);
  if (plan.actorPattern) conds.push(sql`${auditLog.actor} ilike ${plan.actorPattern} escape '\\'`);
  const rows = await db()
    .select()
    .from(auditLog)
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(auditLog.createdAt), desc(auditLog.id))
    .limit(plan.limit)
    .offset(plan.offset);
  return toAuditPage(rows, filter.page);
}

const MAX_STRING = 200;
const MAX_TOTAL = 2000;

/**
 * Pretty JSON for display. Long strings and the overall output are truncated.
 * Output is plain text; the page renders it as a React text node, which escapes it.
 */
export function formatMeta(meta: unknown): string {
  if (meta === null || meta === undefined) return "";
  let text: string;
  try {
    text =
      JSON.stringify(
        meta,
        (_k, v: unknown) => (typeof v === "string" && v.length > MAX_STRING ? `${v.slice(0, MAX_STRING)}... (+${v.length - MAX_STRING} chars)` : v),
        2,
      ) ?? "";
  } catch {
    return "[unserialisable]";
  }
  return text.length > MAX_TOTAL ? `${text.slice(0, MAX_TOTAL)}\n... (truncated, ${text.length - MAX_TOTAL} more chars)` : text;
}
