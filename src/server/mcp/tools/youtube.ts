import { getGoogleAuth } from "@/server/google/auth";
import * as yt from "@/server/google/youtube";
import { defineTool } from "./types";
import { asOutput } from "./google";

export const ytListChannels = defineTool({
  name: "yt_list_channels",
  title: "List the connected YouTube channel",
  description:
    "Show the YouTube channel the user connected (title, subscribers, video count, lifetime views). Call this first to confirm which channel the other yt_* tools read. They always read this channel.",
  inputSchema: yt.listChannelsInput.shape,
  async handler(_args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await yt.listChannels(auth, { maxRows: limits.maxRowsPerCall }));
  },
});

export const ytAnalyticsReport = defineTool({
  name: "yt_analytics_report",
  title: "YouTube Analytics report",
  description:
    "Run a YouTube Analytics report for the connected channel, or for one video via `videoId`: choose metrics (views, estimatedMinutesWatched, subscribersGained, ...) and optional dimensions (day, month, country, deviceType, insightTrafficSourceType). Defaults to the last 28 days. YouTube data lags about 2 days. Rows come back as arrays in the order of `columns`.",
  inputSchema: yt.analyticsReportInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await yt.analyticsReport(auth, args, { maxRows: limits.maxRowsPerCall }), args.videoId);
  },
});

export const ytTopVideos = defineTool({
  name: "yt_top_videos",
  title: "Top YouTube videos",
  description:
    "Rank the connected channel's videos for a period by views, watch time, likes, comments, shares or subscribers gained, with titles. Use it to find video ids for yt_analytics_report. Defaults to the top 10 over the last 28 days.",
  inputSchema: yt.topVideosInput.shape,
  async handler(args, { user, limits }) {
    const auth = await getGoogleAuth(user.id);
    return asOutput(await yt.topVideos(auth, args, { maxRows: limits.maxRowsPerCall }));
  },
});

export const YOUTUBE_TOOLS = [ytListChannels, ytAnalyticsReport, ytTopVideos];
