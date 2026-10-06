import { describe, expect, it } from "vitest";
import { inspectUrl, listSitemaps, listSites, searchAnalytics, searchAnalyticsInput } from "@/server/google/gsc";
import { fakeAuth, mockFetch } from "./helpers";

const site = "https://example.com/";
const now = () => new Date("2026-10-06T12:00:00Z");

describe("searchAnalytics", () => {
  const rows = [
    { keys: ["shoes", "/a"], clicks: 10, impressions: 100, ctr: 0.1, position: 3.14159 },
    { keys: ["boots", "/b"], clicks: 1, impressions: 50, ctr: 0.02, position: 12.5 },
  ];

  it("builds the request, defaults dates, and returns keyed rows", async () => {
    const { fetch, calls } = mockFetch({ body: { rows } });
    const out = await searchAnalytics(
      fakeAuth,
      { siteUrl: site, dimensions: ["query", "page"], filters: [{ dimension: "query", operator: "contains", expression: "sh" }] },
      { fetch, now },
    );
    expect(out.rows[0]).toEqual({ query: "shoes", page: "/a", clicks: 10, impressions: 100, ctr: 0.1, position: 3.14 });
    expect(out).toMatchObject({ startDate: "2026-09-06", endDate: "2026-10-03", truncated: false, returned: 2 });

    expect(calls[0].url).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/searchAnalytics/query");
    expect(calls[0].body).toMatchObject({
      rowLimit: 100,
      startRow: 0,
      searchType: "web",
      dimensions: ["query", "page"],
      dimensionFilterGroups: [{ groupType: "and", filters: [{ dimension: "query", operator: "contains", expression: "sh" }] }],
    });
  });

  it("supports sc-domain properties and a no-dimension total row", async () => {
    const { fetch, calls } = mockFetch({ body: { rows: [{ clicks: 5, impressions: 9, ctr: 0.5555555, position: 2 }] } });
    const out = await searchAnalytics(fakeAuth, { siteUrl: "sc-domain:example.com" }, { fetch, now });
    expect(calls[0].url).toContain("/sites/sc-domain%3Aexample.com/");
    expect(out.rows).toEqual([{ clicks: 5, impressions: 9, ctr: 0.5556, position: 2 }]);
  });

  it("caps rowLimit by plan and paginates with startRow", async () => {
    const { fetch, calls } = mockFetch({ body: { rows } });
    const out = await searchAnalytics(
      fakeAuth,
      { siteUrl: site, dimensions: ["query", "page"], rowLimit: 20_000, startRow: 40 },
      { fetch, now, maxRows: 2 },
    );
    expect(calls[0].body).toMatchObject({ rowLimit: 2, startRow: 40 });
    expect(out.truncated).toBe(true);
    expect(out.nextStartRow).toBe(42);
  });

  it("applies the 25000 hard cap and default 100", async () => {
    const { fetch, calls } = mockFetch({ body: { rows: [] } });
    await searchAnalytics(fakeAuth, { siteUrl: site, rowLimit: 25_000 }, { fetch, now, maxRows: 10_000_000 });
    expect(calls[0].body!.rowLimit).toBe(25_000);
  });

  it("rejects bad input", () => {
    const base = { siteUrl: site };
    expect(searchAnalyticsInput.safeParse({ ...base, rowLimit: 25_001 }).success).toBe(false);
    expect(searchAnalyticsInput.safeParse({ ...base, startDate: "7daysAgo" }).success).toBe(false);
    expect(searchAnalyticsInput.safeParse({ ...base, startDate: "2026-13-01" }).success).toBe(false);
    expect(searchAnalyticsInput.safeParse({ ...base, startDate: "2026-02-02", endDate: "2026-02-01" }).success).toBe(false);
    expect(searchAnalyticsInput.safeParse({ ...base, dimensions: ["bogus"] }).success).toBe(false);
    expect(searchAnalyticsInput.safeParse({ siteUrl: "example.com" }).success).toBe(false);
    expect(searchAnalyticsInput.parse(base).rowLimit).toBe(100);
  });
});

describe("listSites", () => {
  it("returns compact sites and respects maxRows", async () => {
    const { fetch } = mockFetch({
      body: { siteEntry: [{ siteUrl: site, permissionLevel: "siteOwner" }, { siteUrl: "sc-domain:x.com", permissionLevel: "siteFullUser" }] },
    });
    const all = await listSites(fakeAuth, { fetch });
    expect(all.sites).toHaveLength(2);
    const capped = await listSites(fakeAuth, { fetch, maxRows: 1 });
    expect(capped).toMatchObject({ siteCount: 1, truncated: true });
  });
});

describe("inspectUrl", () => {
  it("returns a compact inspection summary", async () => {
    const { fetch, calls } = mockFetch({
      body: {
        inspectionResult: {
          inspectionResultLink: "https://search.google.com/search-console/inspect?x=1",
          indexStatusResult: {
            verdict: "PASS",
            coverageState: "Submitted and indexed",
            lastCrawlTime: "2026-10-01T00:00:00Z",
            googleCanonical: "https://example.com/a",
            sitemap: ["https://example.com/sitemap.xml"],
            somethingExtra: "dropped",
          },
          mobileUsabilityResult: { verdict: "PASS" },
        },
      },
    });
    const out = await inspectUrl(fakeAuth, { siteUrl: site, inspectionUrl: "https://example.com/a" }, { fetch });
    expect(calls[0].url).toBe("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect");
    expect(calls[0].body).toEqual({ inspectionUrl: "https://example.com/a", siteUrl: site, languageCode: "en-US" });
    expect(out.index?.verdict).toBe("PASS");
    expect(out.index?.sitemaps).toEqual(["https://example.com/sitemap.xml"]);
    expect(JSON.stringify(out)).not.toContain("dropped");
  });

  it("rejects non-http URLs", async () => {
    const { fetch } = mockFetch({ body: {} });
    await expect(inspectUrl(fakeAuth, { siteUrl: site, inspectionUrl: "ftp://example.com/a" }, { fetch })).rejects.toThrow();
  });
});

describe("listSitemaps", () => {
  it("coerces counts and lists sitemaps", async () => {
    const { fetch, calls } = mockFetch({
      body: {
        sitemap: [
          { path: "https://example.com/sitemap.xml", warnings: "2", errors: "0", isPending: false, contents: [{ type: "web", submitted: "10", indexed: "8" }] },
        ],
      },
    });
    const out = await listSitemaps(fakeAuth, { siteUrl: site }, { fetch });
    expect(calls[0].url).toBe("https://www.googleapis.com/webmasters/v3/sites/https%3A%2F%2Fexample.com%2F/sitemaps");
    expect(out.sitemaps[0]).toMatchObject({ warnings: 2, errors: 0, contents: [{ type: "web", submitted: 10, indexed: 8 }] });
  });
});

describe("GSC errors", () => {
  it("maps a 404 to not_found", async () => {
    const { fetch } = mockFetch({ status: 404, body: { error: { code: 404, message: "Not found" } } });
    await expect(listSitemaps(fakeAuth, { siteUrl: site }, { fetch })).rejects.toMatchObject({ code: "not_found" });
  });
  it("maps a network failure to upstream_error", async () => {
    const fetch = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof globalThis.fetch;
    await expect(listSites(fakeAuth, { fetch })).rejects.toMatchObject({ code: "upstream_error" });
  });
});
