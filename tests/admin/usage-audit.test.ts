import { describe, expect, it } from "vitest";
import {
  AUDIT_PAGE_SIZE,
  escapeLike,
  formatMeta,
  parseAuditFilter,
  planAuditQuery,
  toAuditPage,
  type AuditRow,
} from "@/server/admin/queries-audit";

describe("audit filter and plan", () => {
  it("parses and clamps page, trims text", () => {
    expect(parseAuditFilter({})).toEqual({ prefix: "", actor: "", page: 1 });
    expect(parseAuditFilter({ page: "3", prefix: " admin. ", actor: ["a@x.com"] })).toEqual({ prefix: "admin.", actor: "a@x.com", page: 3 });
    expect(parseAuditFilter({ page: "-2" }).page).toBe(1);
    expect(parseAuditFilter({ page: "abc" }).page).toBe(1);
    expect(parseAuditFilter({ page: "99999999" }).page).toBe(10_000);
    expect(parseAuditFilter({ prefix: "x".repeat(500) }).prefix).toHaveLength(100);
  });

  it("escapes LIKE wildcards so input matches literally", () => {
    expect(escapeLike("a%b_c\\d")).toBe("a\\%b\\_c\\\\d");
    const p = planAuditQuery({ prefix: "admin_%", actor: "x%", page: 1 });
    expect(p.actionPattern).toBe("admin\\_\\%%");
    expect(p.actorPattern).toBe("%x\\%%");
  });

  it("paginates 50 per page, fetching one extra row", () => {
    expect(planAuditQuery({ prefix: "", actor: "", page: 1 })).toEqual({ actionPattern: null, actorPattern: null, limit: 51, offset: 0 });
    expect(planAuditQuery({ prefix: "", actor: "", page: 3 }).offset).toBe(100);
  });

  it("detects a next page from the extra row", () => {
    const row = (id: number): AuditRow => ({ id, actor: "a", action: "x", target: null, meta: null, createdAt: new Date() });
    const rows = Array.from({ length: AUDIT_PAGE_SIZE + 1 }, (_, i) => row(i));
    expect(toAuditPage(rows, 1)).toMatchObject({ hasNext: true, page: 1 });
    expect(toAuditPage(rows, 1).rows).toHaveLength(AUDIT_PAGE_SIZE);
    expect(toAuditPage(rows.slice(0, 5), 2).hasNext).toBe(false);
  });
});

describe("formatMeta", () => {
  it("renders pretty JSON as plain text (markup is left for React to escape, never interpreted)", () => {
    const out = formatMeta({ kind: "<img src=x onerror=alert(1)>" });
    expect(out).toContain('"kind": "<img src=x onerror=alert(1)>"');
    expect(out.split("\n").length).toBeGreaterThan(1);
  });
  it("truncates huge string values and huge totals", () => {
    const s = formatMeta({ v: "x".repeat(5000) });
    expect(s.length).toBeLessThan(400);
    expect(s).toContain("+4800 chars");
    const big = formatMeta(Object.fromEntries(Array.from({ length: 500 }, (_, i) => [`k${i}`, "y".repeat(50)])));
    expect(big.length).toBeLessThan(2200);
    expect(big).toContain("truncated");
  });
  it("handles null and circular input", () => {
    expect(formatMeta(null)).toBe("");
    const c: Record<string, unknown> = {};
    c.self = c;
    expect(formatMeta(c)).toBe("[unserialisable]");
  });
});
