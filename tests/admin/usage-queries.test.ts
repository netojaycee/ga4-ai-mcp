import { describe, expect, it } from "vitest";
import { buildUsageView, parseWindow, windowStart } from "@/server/admin/queries-usage";

const NOW = new Date("2026-10-06T15:00:00Z");

describe("parseWindow", () => {
  it("accepts 7, 14, 30 and falls back to 14", () => {
    expect(parseWindow("7")).toBe(7);
    expect(parseWindow("30")).toBe(30);
    expect(parseWindow(["7", "30"])).toBe(7);
    for (const bad of [undefined, "", "5", "abc", "-7", "14.5", "1e1"]) expect(parseWindow(bad)).toBe(14);
  });
});

describe("windowStart", () => {
  it("is the UTC midnight (days-1) days back, so today is included", () => {
    expect(windowStart(7, NOW).toISOString()).toBe("2026-09-30T00:00:00.000Z");
  });
});

describe("buildUsageView", () => {
  const raw = {
    daily: [
      { day: "2026-10-06", ok: 8, err: 2 },
      { day: "2026-10-04", ok: "5", err: "0" },
      { day: "2026-01-01", ok: 99, err: 99 },
    ],
    users: [
      { email: "a@x.com", calls: 10, errors: 2 },
      { email: null, calls: 3, errors: 0 },
    ],
    tools: [
      { tool: "run_report", calls: 10, errors: 2, p50: "120.4", p95: 900.6 },
      { tool: "list_sites", calls: 0, errors: 0, p50: null, p95: null },
    ],
    errors: [
      { error_code: "quota", n: "2" },
      { error_code: null, n: 1 },
    ],
  };
  const v = buildUsageView(raw, 7, NOW);

  it("fills missing days, ignores out-of-window rows and computes totals", () => {
    expect(v.daily).toHaveLength(7);
    expect(v.daily[0].day).toBe("2026-09-30");
    expect(v.daily.at(-1)).toEqual({ day: "2026-10-06", ok: 8, err: 2 });
    expect(v.daily.find((d) => d.day === "2026-10-05")).toEqual({ day: "2026-10-05", ok: 0, err: 0 });
    expect(v.totals).toEqual({ calls: 15, errors: 2, errorRate: 2 / 15 });
    expect(v.maxDaily).toBe(10);
  });

  it("maps users, tools (rounded percentiles, safe rates) and error codes", () => {
    expect(v.topUsers[1].email).toBe("(deleted user)");
    expect(v.tools[0]).toMatchObject({ errorRate: 0.2, p50: 120, p95: 901 });
    expect(v.tools[1]).toMatchObject({ errorRate: 0, p50: null, p95: null });
    expect(v.errorCodes).toEqual([
      { code: "quota", count: 2 },
      { code: "(none)", count: 1 },
    ]);
  });

  it("handles an empty window", () => {
    const e = buildUsageView({ daily: [], users: [], tools: [], errors: [] }, 14, NOW);
    expect(e.totals).toEqual({ calls: 0, errors: 0, errorRate: 0 });
    expect(e.maxDaily).toBe(1);
    expect(e.daily).toHaveLength(14);
  });
});
