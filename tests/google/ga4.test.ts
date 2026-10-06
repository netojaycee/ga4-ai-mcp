import { describe, expect, it } from "vitest";
import {
  getMetadata,
  listProperties,
  runRealtimeReport,
  runReport,
  runReportInput,
  runRealtimeReportInput,
} from "@/server/google/ga4";
import { fakeAuth, mockFetch } from "./helpers";

const reportBody = {
  dimensionHeaders: [{ name: "country" }],
  metricHeaders: [{ name: "activeUsers", type: "TYPE_INTEGER" }, { name: "bounceRate", type: "TYPE_FLOAT" }],
  rows: [
    { dimensionValues: [{ value: "US" }], metricValues: [{ value: "120" }, { value: "0.41" }] },
    { dimensionValues: [{ value: "DE" }], metricValues: [{ value: "30" }, { value: "0.5" }] },
  ],
  totals: [{ dimensionValues: [{ value: "RESERVED_TOTAL" }], metricValues: [{ value: "150" }, { value: "0.43" }] }],
  rowCount: 2,
};

describe("runReport", () => {
  it("sends a well-formed request and returns compact keyed rows", async () => {
    const { fetch, calls } = mockFetch({ body: reportBody });
    const out = await runReport(
      fakeAuth,
      {
        property: "properties/123",
        dimensions: ["country"],
        metrics: ["activeUsers", "bounceRate"],
        dateRanges: [{ startDate: "7daysAgo", endDate: "today" }],
        dimensionFilters: [
          { field: "country", operator: "in_list", value: ["US", "DE"] },
          { field: "pagePath", operator: "contains", value: "/blog", not: true },
        ],
        metricFilters: [{ field: "activeUsers", operator: "gt", value: 10 }],
        orderBy: [{ field: "activeUsers" }],
      },
      { fetch },
    );
    expect(out.rows).toEqual([
      { country: "US", activeUsers: 120, bounceRate: 0.41 },
      { country: "DE", activeUsers: 30, bounceRate: 0.5 },
    ]);
    expect(out.totals).toEqual({ activeUsers: 150, bounceRate: 0.43 });
    expect(out).toMatchObject({ rowCount: 2, returned: 2, truncated: false, property: "properties/123" });

    const [c] = calls;
    expect(c.url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/123:runReport");
    expect(c.method).toBe("POST");
    expect(c.headers.authorization).toBe("Bearer test-access-token");
    expect(c.body).toMatchObject({
      limit: "100",
      offset: "0",
      dimensions: [{ name: "country" }],
      orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
      metricFilter: { filter: { fieldName: "activeUsers" } },
    });
    const df = c.body!.dimensionFilter as { andGroup: { expressions: unknown[] } };
    expect(df.andGroup.expressions).toHaveLength(2);
    expect(df.andGroup.expressions[0]).toEqual({
      filter: { fieldName: "country", inListFilter: { values: ["US", "DE"], caseSensitive: false } },
    });
    expect(df.andGroup.expressions[1]).toMatchObject({ notExpression: { filter: { fieldName: "pagePath" } } });
  });

  it("flags truncation and gives the next offset when more rows exist", async () => {
    const { fetch } = mockFetch({ body: { ...reportBody, rowCount: 500 } });
    const out = await runReport(fakeAuth, { property: "1", metrics: ["activeUsers"] }, { fetch });
    expect(out.truncated).toBe(true);
    expect(out.nextOffset).toBe(2);
  });

  it("accepts a plain numeric property id and defaults the date range", async () => {
    const { fetch, calls } = mockFetch({ body: reportBody });
    await runReport(fakeAuth, { property: "42", metrics: ["sessions"] }, { fetch });
    expect(calls[0].url).toContain("/properties/42:runReport");
    expect(calls[0].body!.dateRanges).toEqual([{ startDate: "28daysAgo", endDate: "yesterday" }]);
  });

  it("lowers the row cap to the plan limit (maxRows)", async () => {
    const { fetch, calls } = mockFetch({ body: reportBody });
    const out = await runReport(fakeAuth, { property: "1", metrics: ["sessions"], limit: 5000 }, { fetch, maxRows: 250 });
    expect(calls[0].body!.limit).toBe("250");
    expect(out.limit).toBe(250);
  });

  it("never exceeds the hard cap and uses default 100", async () => {
    const { fetch, calls } = mockFetch({ body: reportBody });
    await runReport(fakeAuth, { property: "1", metrics: ["sessions"] }, { fetch, maxRows: 1_000_000 });
    expect(calls[0].body!.limit).toBe("100");
    await runReport(fakeAuth, { property: "1", metrics: ["sessions"], limit: 10_000 }, { fetch, maxRows: 1_000_000 });
    expect(calls[1].body!.limit).toBe("10000");
  });

  it("rejects ordering by a field that is not requested, as invalid_input", async () => {
    const { fetch } = mockFetch({ body: reportBody });
    await expect(
      runReport(fakeAuth, { property: "1", metrics: ["sessions"], orderBy: [{ field: "country" }] }, { fetch }),
    ).rejects.toMatchObject({ code: "invalid_input" });
  });
});

describe("GA4 schemas", () => {
  const base = { property: "1", metrics: ["sessions"] };
  it("rejects limit above 10000 or below 1", () => {
    expect(runReportInput.safeParse({ ...base, limit: 10_001 }).success).toBe(false);
    expect(runReportInput.safeParse({ ...base, limit: 0 }).success).toBe(false);
    expect(runReportInput.parse(base).limit).toBe(100);
  });
  it("accepts ISO and relative dates, rejects bad ones", () => {
    const ok = (d: string) => runReportInput.safeParse({ ...base, dateRanges: [{ startDate: d, endDate: "today" }] }).success;
    expect(ok("2026-01-31")).toBe(true);
    expect(ok("7daysAgo")).toBe(true);
    expect(ok("yesterday")).toBe(true);
    expect(ok("2026-02-30")).toBe(false);
    expect(ok("01/02/2026")).toBe(false);
    expect(ok("lastweek")).toBe(false);
  });
  it("rejects start after end for absolute dates", () => {
    const r = runReportInput.safeParse({ ...base, dateRanges: [{ startDate: "2026-02-02", endDate: "2026-02-01" }] });
    expect(r.success).toBe(false);
  });
  it("requires at least one metric and a valid property", () => {
    expect(runReportInput.safeParse({ property: "1", metrics: [] }).success).toBe(false);
    expect(runReportInput.safeParse({ property: "abc", metrics: ["sessions"] }).success).toBe(false);
  });
  it("validates realtime minute ranges", () => {
    expect(runRealtimeReportInput.safeParse({ ...base, minuteRanges: [{ startMinutesAgo: 5, endMinutesAgo: 0 }] }).success).toBe(true);
    expect(runRealtimeReportInput.safeParse({ ...base, minuteRanges: [{ startMinutesAgo: 0, endMinutesAgo: 5 }] }).success).toBe(false);
    expect(runRealtimeReportInput.safeParse({ ...base, minuteRanges: [{ startMinutesAgo: 60, endMinutesAgo: 0 }] }).success).toBe(false);
  });
});

describe("runRealtimeReport", () => {
  it("calls the realtime endpoint without date ranges", async () => {
    const { fetch, calls } = mockFetch({ body: reportBody });
    const out = await runRealtimeReport(fakeAuth, { property: "9", dimensions: ["country"], metrics: ["activeUsers"] }, { fetch, maxRows: 10 });
    expect(calls[0].url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/9:runRealtimeReport");
    expect(calls[0].body).not.toHaveProperty("dateRanges");
    expect(calls[0].body!.limit).toBe("10");
    expect(out).toMatchObject({ realtime: true });
    expect(out.rows).toHaveLength(2);
  });
});

describe("getMetadata", () => {
  const meta = {
    dimensions: [
      { apiName: "country", uiName: "Country", category: "Geography", description: "d".repeat(500) },
      { apiName: "customEvent:plan", uiName: "Plan", category: "Custom", customDefinition: true },
    ],
    metrics: [{ apiName: "activeUsers", uiName: "Active users", category: "User", type: "TYPE_INTEGER" }],
  };
  it("returns compact names, filters by search and custom flag", async () => {
    const { fetch, calls } = mockFetch({ body: meta });
    const all = await getMetadata(fakeAuth, { property: "7" }, { fetch });
    expect(calls[0].url).toBe("https://analyticsdata.googleapis.com/v1beta/properties/7/metadata");
    expect(all.dimensionCount).toBe(2);
    expect(JSON.stringify(all)).not.toContain("ddd");

    const searched = await getMetadata(fakeAuth, { property: "7", search: "geo", kind: "dimensions" }, { fetch });
    expect(searched.dimensions.map((d) => d.apiName)).toEqual(["country"]);
    expect(searched.metrics).toEqual([]);

    const custom = await getMetadata(fakeAuth, { property: "7", customOnly: true }, { fetch });
    expect(custom.dimensions.map((d) => d.apiName)).toEqual(["customEvent:plan"]);
    expect(custom.metrics).toEqual([]);
  });
});

describe("listProperties", () => {
  const page = (token?: string) => ({
    accountSummaries: [
      {
        account: "accounts/1",
        displayName: "Acme",
        propertySummaries: [
          { property: "properties/11", displayName: "Site A", propertyType: "PROPERTY_TYPE_ORDINARY" },
          { property: "properties/12", displayName: "Site B" },
        ],
      },
    ],
    nextPageToken: token,
  });
  it("follows pagination", async () => {
    const { fetch, calls } = mockFetch([{ body: page("t2") }, { body: page() }]);
    const out = await listProperties(fakeAuth, { fetch });
    expect(out.propertyCount).toBe(4);
    expect(out.truncated).toBe(false);
    expect(calls[1].url).toContain("pageToken=t2");
  });
  it("respects maxRows", async () => {
    const { fetch } = mockFetch([{ body: page("t2") }, { body: page() }]);
    const out = await listProperties(fakeAuth, { fetch, maxRows: 3 });
    expect(out.propertyCount).toBe(3);
    expect(out.truncated).toBe(true);
  });
});
