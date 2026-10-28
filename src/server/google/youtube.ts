import { z } from "zod";
import { ToolError } from "@/server/errors";
import type { GoogleAuth } from "./auth";
import { capLimit, googleJson, type CallOptions } from "./http";

const DATA_API = "https://www.googleapis.com/youtube/v3";
const ANALYTICS_API = "https://youtubeanalytics.googleapis.com/v2/reports";

const SCOPE_DATA = "https://www.googleapis.com/auth/youtube.readonly";
const SCOPE_ANALYTICS = "https://www.googleapis.com/auth/yt-analytics.readonly";

export const YT_DEFAULT_TOP_VIDEOS = 10;
export const YT_MAX_ROWS = 200;
/** YouTube Analytics data lags by about two days. */
const DATA_LAG_DAYS = 2;
const DEFAULT_WINDOW_DAYS = 28;

/** YouTube is an optional add-on: other tools keep working for users who never connected it. */
export function requireYouTube(auth: GoogleAuth): void {
  if (!auth.scopes.includes(SCOPE_DATA) || !auth.scopes.includes(SCOPE_ANALYTICS)) {
    throw new ToolError(
      "auth_required",
      "YouTube is not connected for this account. Ask the user to open their account page on this service and click 'Connect YouTube' (read-only), then try again.",
    );
  }
}

// ---------------------------------------------------------------- input schemas

const isRealDate = (s: string) => {
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const dateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD")
  .refine(isRealDate, { message: "Not a real calendar date" })
  .describe("YYYY-MM-DD");

const videoIdSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{6,20}$/, "Use a YouTube video id such as 'dQw4w9WgXcQ'")
  .describe("YouTube video id (from yt_top_videos)");

export const YT_METRICS = [
  "views",
  "estimatedMinutesWatched",
  "averageViewDuration",
  "averageViewPercentage",
  "likes",
  "comments",
  "shares",
  "subscribersGained",
  "subscribersLost",
] as const;

export const YT_DIMENSIONS = ["day", "month", "country", "deviceType", "insightTrafficSourceType"] as const;

const dateRange = z.object({
  startDate: dateSchema.optional().describe("Default: 28 days ending 2 days ago"),
  endDate: dateSchema.optional(),
});
const orderedDates = (v: { startDate?: string; endDate?: string }) => !(v.startDate && v.endDate) || v.startDate <= v.endDate;
const orderedMsg = { message: "startDate must not be after endDate", path: ["startDate"] };

export const listChannelsInput = z.object({});

export const analyticsReportInput = dateRange
  .extend({
    metrics: z.array(z.enum(YT_METRICS)).min(1).max(9).default(["views", "estimatedMinutesWatched", "subscribersGained"]),
    dimensions: z
      .array(z.enum(YT_DIMENSIONS))
      .max(2)
      .default([])
      .describe("Group rows by these; empty gives one total row. 'day'/'month' give a time series"),
    videoId: videoIdSchema.optional().describe("Limit the report to one video; omit for the whole channel"),
    sort: z.string().regex(/^-?[A-Za-z]+$/).max(60).optional().describe("A requested metric or dimension; prefix '-' for descending"),
    maxResults: z.number().int().min(1).max(YT_MAX_ROWS).default(50).describe(`Rows to return (max ${YT_MAX_ROWS}; your plan may lower it)`),
  })
  .refine(orderedDates, orderedMsg);
export type AnalyticsReportInput = z.input<typeof analyticsReportInput>;

export const topVideosInput = dateRange
  .extend({
    metric: z.enum(["views", "estimatedMinutesWatched", "likes", "comments", "shares", "subscribersGained"]).default("views").describe("Rank videos by this"),
    limit: z.number().int().min(1).max(50).default(YT_DEFAULT_TOP_VIDEOS),
  })
  .refine(orderedDates, orderedMsg);
export type TopVideosInput = z.input<typeof topVideosInput>;

// ---------------------------------------------------------------- helpers

const iso = (d: Date) => d.toISOString().slice(0, 10);
const daysBefore = (d: Date, n: number) => new Date(d.getTime() - n * 86_400_000);

function resolveRange(input: { startDate?: string; endDate?: string }, opts: CallOptions) {
  const today = (opts.now ?? (() => new Date()))();
  const endDate = input.endDate ?? iso(daysBefore(today, DATA_LAG_DAYS));
  const startDate = input.startDate ?? iso(daysBefore(new Date(`${endDate}T00:00:00Z`), DEFAULT_WINDOW_DAYS - 1));
  return { startDate, endDate };
}

const reportResponse = z
  .object({
    columnHeaders: z.array(z.object({ name: z.string() }).loose()).default([]),
    rows: z.array(z.array(z.union([z.string(), z.number()]))).default([]),
  })
  .loose();

async function runAnalytics(
  auth: GoogleAuth,
  params: Record<string, string>,
  opts: CallOptions,
): Promise<{ columns: string[]; rows: (string | number)[][] }> {
  const url = `${ANALYTICS_API}?${new URLSearchParams({ ids: "channel==MINE", ...params }).toString()}`;
  const res = reportResponse.parse(await googleJson(auth, url, { fetch: opts.fetch }));
  return { columns: res.columnHeaders.map((c) => c.name), rows: res.rows };
}

// ---------------------------------------------------------------- operations

const channelsResponse = z
  .object({
    items: z
      .array(
        z
          .object({
            id: z.string(),
            snippet: z.object({ title: z.string().optional(), customUrl: z.string().optional() }).loose().optional(),
            statistics: z
              .object({ subscriberCount: z.string().optional(), videoCount: z.string().optional(), viewCount: z.string().optional(), hiddenSubscriberCount: z.boolean().optional() })
              .loose()
              .optional(),
          })
          .loose(),
      )
      .default([]),
  })
  .loose();

const num = (s: string | undefined) => (s === undefined ? undefined : Number(s));

/** The channel the user picked at Google's consent screen (a brand channel if they chose one). */
export async function listChannels(auth: GoogleAuth, opts: CallOptions = {}) {
  requireYouTube(auth);
  const res = channelsResponse.parse(
    await googleJson(auth, `${DATA_API}/channels?part=snippet,statistics&mine=true&maxResults=50`, { fetch: opts.fetch }),
  );
  const items = res.items.slice(0, capLimit(Infinity, Infinity, opts.maxRows));
  return {
    returned: items.length,
    channels: items.map((c) => ({
      channelId: c.id,
      title: c.snippet?.title,
      customUrl: c.snippet?.customUrl,
      subscribers: c.statistics?.hiddenSubscriberCount ? undefined : num(c.statistics?.subscriberCount),
      videos: num(c.statistics?.videoCount),
      lifetimeViews: num(c.statistics?.viewCount),
    })),
  };
}

export async function analyticsReport(auth: GoogleAuth, rawInput: AnalyticsReportInput, opts: CallOptions = {}) {
  requireYouTube(auth);
  const input = analyticsReportInput.parse(rawInput);
  const range = resolveRange(input, opts);
  const maxResults = capLimit(input.maxResults, YT_MAX_ROWS, opts.maxRows);
  const params: Record<string, string> = {
    ...range,
    metrics: input.metrics.join(","),
    maxResults: String(maxResults),
  };
  if (input.dimensions.length) params.dimensions = input.dimensions.join(",");
  if (input.videoId) params.filters = `video==${input.videoId}`;
  if (input.sort) params.sort = input.sort;
  else if (input.dimensions[0] === "day" || input.dimensions[0] === "month") params.sort = input.dimensions[0];

  const { columns, rows } = await runAnalytics(auth, params, opts);
  return { ...range, columns, returned: rows.length, rows };
}

const videosResponse = z
  .object({ items: z.array(z.object({ id: z.string(), snippet: z.object({ title: z.string().optional(), publishedAt: z.string().optional() }).loose().optional() }).loose()).default([]) })
  .loose();

/** Top videos in a period, with titles looked up from the Data API (one extra cheap call). */
export async function topVideos(auth: GoogleAuth, rawInput: TopVideosInput, opts: CallOptions = {}) {
  requireYouTube(auth);
  const input = topVideosInput.parse(rawInput);
  const range = resolveRange(input, opts);
  const limit = capLimit(input.limit, 50, opts.maxRows);
  const metrics = [...new Set([input.metric, "views", "estimatedMinutesWatched", "likes", "comments"])];
  const { columns, rows } = await runAnalytics(
    auth,
    { ...range, dimensions: "video", metrics: metrics.join(","), sort: `-${input.metric}`, maxResults: String(limit) },
    opts,
  );

  const ids = rows.map((r) => String(r[0]));
  const titles = new Map<string, { title?: string; publishedAt?: string }>();
  if (ids.length) {
    const v = videosResponse.parse(
      await googleJson(auth, `${DATA_API}/videos?part=snippet&id=${ids.map(encodeURIComponent).join(",")}&maxResults=50`, { fetch: opts.fetch }),
    );
    for (const item of v.items) titles.set(item.id, { title: item.snippet?.title, publishedAt: item.snippet?.publishedAt });
  }

  return {
    ...range,
    rankedBy: input.metric,
    returned: rows.length,
    videos: rows.map((r) => {
      const metricValues = Object.fromEntries(columns.slice(1).map((c, i) => [c, r[i + 1]]));
      const id = String(r[0]);
      return { videoId: id, ...titles.get(id), ...metricValues };
    }),
  };
}
