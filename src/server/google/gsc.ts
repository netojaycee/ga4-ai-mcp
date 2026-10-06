import { z } from "zod";
import type { GoogleAuth } from "./auth";
import { capLimit, googleJson, type CallOptions } from "./http";

const WEBMASTERS = "https://www.googleapis.com/webmasters/v3";
const INSPECT_URL = "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect";

export const GSC_DEFAULT_ROW_LIMIT = 100;
export const GSC_MAX_ROW_LIMIT = 25_000;
/** Search Console data lags by roughly this many days. */
const DATA_LAG_DAYS = 3;
const DEFAULT_WINDOW_DAYS = 28;

// ---------------------------------------------------------------- input schemas

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

export const gscDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isRealDate, { message: "Not a real calendar date" })
  .describe("YYYY-MM-DD (Search Console does not accept relative dates)");

export const siteUrlSchema = z
  .string()
  .min(1)
  .max(2048)
  .regex(/^(https?:\/\/|sc-domain:)\S+$/, "Use the exact site from gsc_list_sites, e.g. 'https://example.com/' or 'sc-domain:example.com'")
  .describe("Exact siteUrl from gsc_list_sites, e.g. 'https://example.com/' or 'sc-domain:example.com'");

export const GSC_DIMENSIONS = ["query", "page", "country", "device", "date", "searchAppearance"] as const;

export const gscFilterSchema = z.object({
  dimension: z.enum(["query", "page", "country", "device", "searchAppearance"]),
  operator: z.enum(["equals", "notEquals", "contains", "notContains", "includingRegex", "excludingRegex"]).default("equals"),
  expression: z.string().min(1).max(500).describe("Value to match; country as ISO 3166-1 alpha-3 lowercase (e.g. 'usa'), device as DESKTOP/MOBILE/TABLET"),
});

export const searchAnalyticsInput = z
  .object({
    siteUrl: siteUrlSchema,
    startDate: gscDateSchema.optional().describe("Default: 28 days ending 3 days ago"),
    endDate: gscDateSchema.optional(),
    dimensions: z.array(z.enum(GSC_DIMENSIONS)).max(6).default([]).describe("Group rows by these; empty gives one total row"),
    searchType: z.enum(["web", "image", "video", "news", "discover", "googleNews"]).default("web"),
    filters: z.array(gscFilterSchema).max(10).optional().describe("All must match (AND)"),
    dataState: z.enum(["final", "all"]).default("final").describe("'all' includes fresh, not yet final data"),
    rowLimit: z
      .number()
      .int()
      .min(1)
      .max(GSC_MAX_ROW_LIMIT)
      .default(GSC_DEFAULT_ROW_LIMIT)
      .describe(`Rows per call (default ${GSC_DEFAULT_ROW_LIMIT}, max ${GSC_MAX_ROW_LIMIT}; your plan may lower it)`),
    startRow: z.number().int().min(0).max(1_000_000).default(0).describe("Zero-based row offset for paging"),
  })
  .refine((v) => !(v.startDate && v.endDate) || v.startDate <= v.endDate, {
    message: "startDate must not be after endDate",
    path: ["startDate"],
  });
export type SearchAnalyticsInput = z.input<typeof searchAnalyticsInput>;

export const listSitesInput = z.object({});

export const inspectUrlInput = z.object({
  siteUrl: siteUrlSchema,
  inspectionUrl: z
    .string()
    .url()
    .max(2048)
    .refine((u) => /^https?:\/\//.test(u), { message: "Must be http(s)" })
    .describe("Full URL to inspect; must belong to the property in siteUrl"),
  languageCode: z.string().regex(/^[a-z]{2}(-[A-Z]{2})?$/).default("en-US"),
});
export type InspectUrlInput = z.input<typeof inspectUrlInput>;

export const listSitemapsInput = z.object({ siteUrl: siteUrlSchema });
export type ListSitemapsInput = z.input<typeof listSitemapsInput>;

// ---------------------------------------------------------------- helpers

const str = z.string();
const maybeStr = z.string().optional();
const encodeSite = (s: string) => encodeURIComponent(s);
const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);
const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

function listCap<T>(items: T[], maxRows?: number) {
  const cap = capLimit(Infinity, Infinity, maxRows);
  return { items: items.slice(0, cap), truncated: items.length > cap };
}

// ---------------------------------------------------------------- operations

const sitesResponse = z
  .object({ siteEntry: z.array(z.object({ siteUrl: str, permissionLevel: maybeStr })).default([]) })
  .loose();

export async function listSites(auth: GoogleAuth, opts: CallOptions = {}) {
  const res = sitesResponse.parse(await googleJson(auth, `${WEBMASTERS}/sites`, { fetch: opts.fetch }));
  const { items, truncated } = listCap(res.siteEntry, opts.maxRows);
  return {
    siteCount: items.length,
    truncated,
    sites: items.map((s) => ({ siteUrl: s.siteUrl, permissionLevel: s.permissionLevel })),
  };
}

const analyticsResponse = z
  .object({
    rows: z
      .array(
        z.object({
          keys: z.array(str).optional(),
          clicks: z.number().default(0),
          impressions: z.number().default(0),
          ctr: z.number().default(0),
          position: z.number().default(0),
        }),
      )
      .default([]),
    responseAggregationType: maybeStr,
  })
  .loose();

export async function searchAnalytics(auth: GoogleAuth, rawInput: SearchAnalyticsInput, opts: CallOptions = {}) {
  const input = searchAnalyticsInput.parse(rawInput);
  const limit = capLimit(input.rowLimit, GSC_MAX_ROW_LIMIT, opts.maxRows);
  const today = (opts.now ?? (() => new Date()))();
  const endDate = input.endDate ?? iso(daysBefore(today, DATA_LAG_DAYS));
  const startDate = input.startDate ?? iso(daysBefore(new Date(`${endDate}T00:00:00Z`), DEFAULT_WINDOW_DAYS - 1));

  const raw = await googleJson(auth, `${WEBMASTERS}/sites/${encodeSite(input.siteUrl)}/searchAnalytics/query`, {
    method: "POST",
    fetch: opts.fetch,
    body: {
      startDate,
      endDate,
      dimensions: input.dimensions,
      searchType: input.searchType,
      dataState: input.dataState,
      rowLimit: limit,
      startRow: input.startRow,
      ...(input.filters?.length
        ? { dimensionFilterGroups: [{ groupType: "and", filters: input.filters }] }
        : {}),
    },
  });

  const res = analyticsResponse.parse(raw);
  const rows = res.rows.map((r) => {
    const o: Record<string, unknown> = {};
    input.dimensions.forEach((d, i) => (o[d] = r.keys?.[i] ?? ""));
    o.clicks = r.clicks;
    o.impressions = r.impressions;
    o.ctr = round(r.ctr, 4);
    o.position = round(r.position, 2);
    return o;
  });
  // The API reports no total, so a full page means there may be more.
  const truncated = rows.length >= limit;
  return {
    siteUrl: input.siteUrl,
    startDate,
    endDate,
    dimensions: input.dimensions,
    returned: rows.length,
    limit,
    startRow: input.startRow,
    truncated,
    ...(truncated ? { nextStartRow: input.startRow + rows.length } : {}),
    rows,
  };
}

const issueList = z.array(z.object({ issueType: maybeStr, severity: maybeStr, message: maybeStr }).loose()).optional();

const inspectResponse = z
  .object({
    inspectionResult: z
      .object({
        inspectionResultLink: maybeStr,
        indexStatusResult: z
          .object({
            verdict: maybeStr,
            coverageState: maybeStr,
            robotsTxtState: maybeStr,
            indexingState: maybeStr,
            lastCrawlTime: maybeStr,
            pageFetchState: maybeStr,
            googleCanonical: maybeStr,
            userCanonical: maybeStr,
            crawledAs: maybeStr,
            sitemap: z.array(str).optional(),
            referringUrls: z.array(str).optional(),
          })
          .loose()
          .optional(),
        mobileUsabilityResult: z.object({ verdict: maybeStr, issues: issueList }).loose().optional(),
        richResultsResult: z
          .object({
            verdict: maybeStr,
            detectedItems: z
              .array(z.object({ richResultType: maybeStr, items: z.array(z.object({ name: maybeStr, issues: issueList }).loose()).optional() }).loose())
              .optional(),
          })
          .loose()
          .optional(),
        ampResult: z.object({ verdict: maybeStr, issues: issueList }).loose().optional(),
      })
      .loose()
      .optional(),
  })
  .loose();

const MAX_LIST = 20;

export async function inspectUrl(auth: GoogleAuth, rawInput: InspectUrlInput, opts: CallOptions = {}) {
  const input = inspectUrlInput.parse(rawInput);
  const res = inspectResponse.parse(
    await googleJson(auth, INSPECT_URL, {
      method: "POST",
      fetch: opts.fetch,
      body: { inspectionUrl: input.inspectionUrl, siteUrl: input.siteUrl, languageCode: input.languageCode },
    }),
  );
  const r = res.inspectionResult;
  const idx = r?.indexStatusResult;
  return {
    inspectionUrl: input.inspectionUrl,
    siteUrl: input.siteUrl,
    reportLink: r?.inspectionResultLink,
    index: idx && {
      verdict: idx.verdict,
      coverageState: idx.coverageState,
      indexingState: idx.indexingState,
      robotsTxtState: idx.robotsTxtState,
      pageFetchState: idx.pageFetchState,
      lastCrawlTime: idx.lastCrawlTime,
      crawledAs: idx.crawledAs,
      googleCanonical: idx.googleCanonical,
      userCanonical: idx.userCanonical,
      sitemaps: idx.sitemap?.slice(0, MAX_LIST),
      referringUrls: idx.referringUrls?.slice(0, MAX_LIST),
    },
    mobileUsability: r?.mobileUsabilityResult && {
      verdict: r.mobileUsabilityResult.verdict,
      issues: r.mobileUsabilityResult.issues?.slice(0, MAX_LIST).map((i) => ({ type: i.issueType, severity: i.severity, message: i.message })),
    },
    richResults: r?.richResultsResult && {
      verdict: r.richResultsResult.verdict,
      detected: r.richResultsResult.detectedItems?.slice(0, MAX_LIST).map((d) => ({
        type: d.richResultType,
        itemCount: d.items?.length ?? 0,
        issues: d.items?.flatMap((i) => i.issues ?? []).slice(0, MAX_LIST).map((i) => ({ type: i.issueType, severity: i.severity, message: i.message })),
      })),
    },
    amp: r?.ampResult && { verdict: r.ampResult.verdict, issues: r.ampResult.issues?.slice(0, MAX_LIST).map((i) => ({ type: i.issueType, severity: i.severity, message: i.message })) },
  };
}

const sitemapsResponse = z
  .object({
    sitemap: z
      .array(
        z
          .object({
            path: str,
            lastSubmitted: maybeStr,
            lastDownloaded: maybeStr,
            isPending: z.boolean().optional(),
            isSitemapsIndex: z.boolean().optional(),
            type: maybeStr,
            warnings: z.coerce.number().optional(),
            errors: z.coerce.number().optional(),
            contents: z.array(z.object({ type: maybeStr, submitted: z.coerce.number().optional(), indexed: z.coerce.number().optional() })).optional(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

export async function listSitemaps(auth: GoogleAuth, rawInput: ListSitemapsInput, opts: CallOptions = {}) {
  const input = listSitemapsInput.parse(rawInput);
  const res = sitemapsResponse.parse(
    await googleJson(auth, `${WEBMASTERS}/sites/${encodeSite(input.siteUrl)}/sitemaps`, { fetch: opts.fetch }),
  );
  const { items, truncated } = listCap(res.sitemap, opts.maxRows);
  return {
    siteUrl: input.siteUrl,
    sitemapCount: items.length,
    truncated,
    sitemaps: items.map((s) => ({
      path: s.path,
      type: s.type,
      isIndex: s.isSitemapsIndex,
      isPending: s.isPending,
      lastSubmitted: s.lastSubmitted,
      lastDownloaded: s.lastDownloaded,
      warnings: s.warnings,
      errors: s.errors,
      contents: s.contents,
    })),
  };
}
