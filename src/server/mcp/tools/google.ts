import { getGoogleAuth } from "@/server/google/auth";
import * as ga4 from "@/server/google/ga4";
import * as gsc from "@/server/google/gsc";
import type { ToolOutput } from "../wrapper";
import { defineTool, type ToolDefinition } from "./types";

/** Compact JSON for the model, plus structured content. Only ids and counts go to usage logging. */
export function asOutput(result: unknown, target?: string): ToolOutput {
  const structured =
    typeof result === "object" && result !== null && !Array.isArray(result)
      ? (result as Record<string, unknown>)
      : { result };
  const rows = typeof structured.returned === "number" ? structured.returned : undefined;
  return { text: JSON.stringify(structured), structured, target, rows };
}

export const ga4ListProperties = defineTool({
  name: "ga4_list_properties",
  title: "List GA4 properties",
  description:
    "List the Google Analytics 4 accounts and properties the connected user can access. Call this first to get the numeric property id that every other ga4_* tool needs.",
  inputSchema: ga4.listPropertiesInput.shape,
  async handler(_args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await ga4.listProperties(auth, { maxRows: limits.maxRowsPerCall }));
  },
});

export const ga4GetMetadata = defineTool({
  name: "ga4_get_metadata",
  title: "GA4 dimensions and metrics",
  description:
    "List the dimensions and metrics available for a GA4 property, including custom ones. Use it to find valid api names before calling ga4_run_report, and use `search` to narrow the list.",
  inputSchema: ga4.getMetadataInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await ga4.getMetadata(auth, args, { maxRows: limits.maxRowsPerCall }), args.property);
  },
});

export const ga4RunReport = defineTool({
  name: "ga4_run_report",
  title: "Run a GA4 report",
  description:
    "Run a Google Analytics 4 report for one property: pick dimensions (e.g. date, country, sessionSource) and metrics (e.g. sessions, activeUsers, conversions) over one or more date ranges. Defaults to the last 28 days and 100 rows; page with `offset`. Check names with ga4_get_metadata if unsure.",
  inputSchema: ga4.runReportInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await ga4.runReport(auth, args, { maxRows: limits.maxRowsPerCall }), args.property);
  },
});

export const ga4RunRealtimeReport = defineTool({
  name: "ga4_run_realtime_report",
  title: "Run a GA4 realtime report",
  description:
    "Run a GA4 realtime report (activity in the last 30 minutes by default) for one property. Use it for 'who is on the site right now' questions, not for historical analysis.",
  inputSchema: ga4.runRealtimeReportInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await ga4.runRealtimeReport(auth, args, { maxRows: limits.maxRowsPerCall }), args.property);
  },
});

export const gscListSites = defineTool({
  name: "gsc_list_sites",
  title: "List Search Console sites",
  description:
    "List the Search Console sites (properties) the connected user can access, with their permission level. Call this first to get the exact siteUrl that the other gsc_* tools need.",
  inputSchema: gsc.listSitesInput.shape,
  async handler(_args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await gsc.listSites(auth, { maxRows: limits.maxRowsPerCall }));
  },
});

export const gscSearchAnalytics = defineTool({
  name: "gsc_search_analytics",
  title: "Search Console performance",
  description:
    "Query Google Search performance (clicks, impressions, CTR, average position) for a site, grouped by query, page, country, device or date, with optional filters. Defaults to the last 28 days ending 3 days ago (Search Console data lags) and 100 rows; page with `startRow`.",
  inputSchema: gsc.searchAnalyticsInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await gsc.searchAnalytics(auth, args, { maxRows: limits.maxRowsPerCall }), args.siteUrl);
  },
});

export const gscInspectUrl = defineTool({
  name: "gsc_inspect_url",
  title: "Inspect a URL",
  description:
    "Check how Google sees one URL: index status, canonical, last crawl, mobile usability and rich results. The URL must belong to the site given in siteUrl.",
  inputSchema: gsc.inspectUrlInput.shape,
  async handler(args, { user }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await gsc.inspectUrl(auth, args), args.siteUrl);
  },
});

export const gscListSitemaps = defineTool({
  name: "gsc_list_sitemaps",
  title: "List sitemaps",
  description: "List the sitemaps submitted for a Search Console site, with last download time, errors and warnings.",
  inputSchema: gsc.listSitemapsInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await gsc.listSitemaps(auth, args, { maxRows: limits.maxRowsPerCall }), args.siteUrl);
  },
});

export const GOOGLE_TOOLS: ToolDefinition[] = [
  ga4ListProperties,
  ga4GetMetadata,
  ga4RunReport,
  ga4RunRealtimeReport,
  gscListSites,
  gscSearchAnalytics,
  gscInspectUrl,
  gscListSitemaps,
];
