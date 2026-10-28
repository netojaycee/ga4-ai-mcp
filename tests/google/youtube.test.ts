import { describe, expect, it } from "vitest";
import type { GoogleAuth } from "@/server/google/auth";
import * as yt from "@/server/google/youtube";
import { mockFetch } from "./helpers";

const SCOPES = [
  "https://www.googleapis.com/auth/youtube.readonly",
  "https://www.googleapis.com/auth/yt-analytics.readonly",
];
const auth: GoogleAuth = { getAccessToken: async () => "tok", scopes: SCOPES };
const now = () => new Date("2026-10-28T12:00:00Z");

describe("youtube data layer", () => {
  it("refuses with a connect-YouTube message when the scopes were never granted", async () => {
    const m = mockFetch({ body: {} });
    const noYt: GoogleAuth = { getAccessToken: async () => "tok", scopes: ["https://www.googleapis.com/auth/analytics.readonly"] };
    for (const call of [
      () => yt.listChannels(noYt, { fetch: m.fetch }),
      () => yt.analyticsReport(noYt, {}, { fetch: m.fetch }),
      () => yt.topVideos(noYt, {}, { fetch: m.fetch }),
    ]) {
      await expect(call()).rejects.toMatchObject({ code: "auth_required" });
    }
    expect(m.calls).toHaveLength(0);
  });

  it("lists the user's own channel (mine=true) with numeric stats", async () => {
    const m = mockFetch({
      body: { items: [{ id: "UC1", snippet: { title: "Chan", customUrl: "@chan" }, statistics: { subscriberCount: "1200", videoCount: "30", viewCount: "99000" } }] },
    });
    const out = await yt.listChannels(auth, { fetch: m.fetch });
    expect(m.calls[0].url).toContain("/channels?");
    expect(m.calls[0].url).toContain("mine=true");
    expect(m.calls[0].headers.authorization).toBe("Bearer tok");
    expect(out.channels[0]).toMatchObject({ channelId: "UC1", title: "Chan", subscribers: 1200, videos: 30, lifetimeViews: 99000 });
  });

  it("report defaults to 28 days ending 2 days ago, always scoped to the authenticated channel", async () => {
    const m = mockFetch({ body: { columnHeaders: [{ name: "day" }, { name: "views" }], rows: [["2026-10-01", 5]] } });
    const out = await yt.analyticsReport(auth, { dimensions: ["day"], metrics: ["views"] }, { fetch: m.fetch, now });
    const u = new URL(m.calls[0].url);
    expect(u.searchParams.get("ids")).toBe("channel==MINE");
    expect(u.searchParams.get("endDate")).toBe("2026-10-26");
    expect(u.searchParams.get("startDate")).toBe("2026-09-29");
    expect(u.searchParams.get("sort")).toBe("day");
    expect(out).toMatchObject({ columns: ["day", "views"], returned: 1 });
  });

  it("a video report filters by video id and the plan row cap only lowers maxResults", async () => {
    const m = mockFetch({ body: { columnHeaders: [], rows: [] } });
    await yt.analyticsReport(auth, { videoId: "abcDEF123_-", maxResults: 200 }, { fetch: m.fetch, now, maxRows: 25 });
    const u = new URL(m.calls[0].url);
    expect(u.searchParams.get("filters")).toBe("video==abcDEF123_-");
    expect(u.searchParams.get("maxResults")).toBe("25");
  });

  it("rejects ids that could smuggle extra filter syntax, and reversed dates", async () => {
    const m = mockFetch({ body: {} });
    await expect(yt.analyticsReport(auth, { videoId: "a;channel==UCother" }, { fetch: m.fetch })).rejects.toThrow();
    await expect(yt.analyticsReport(auth, { startDate: "2026-02-01", endDate: "2026-01-01" }, { fetch: m.fetch })).rejects.toThrow();
    expect(m.calls).toHaveLength(0);
  });

  it("top videos ranks by the chosen metric and joins titles from the Data API", async () => {
    const m = mockFetch([
      { body: { columnHeaders: [{ name: "video" }, { name: "views" }, { name: "estimatedMinutesWatched" }, { name: "likes" }, { name: "comments" }], rows: [["v1", 10, 5, 2, 1], ["v2", 4, 2, 1, 0]] } },
      { body: { items: [{ id: "v1", snippet: { title: "First", publishedAt: "2026-01-01T00:00:00Z" } }, { id: "v2", snippet: { title: "Second" } }] } },
    ]);
    const out = await yt.topVideos(auth, { limit: 2 }, { fetch: m.fetch, now });
    expect(new URL(m.calls[0].url).searchParams.get("sort")).toBe("-views");
    expect(m.calls[1].url).toContain("/videos?part=snippet&id=v1,v2");
    expect(out.videos[0]).toMatchObject({ videoId: "v1", title: "First", views: 10, likes: 2 });
  });

  it("Google 403 maps to a friendly permission error, not a raw body", async () => {
    const m = mockFetch({ status: 403, body: { error: { message: "secret detail", errors: [{ reason: "forbidden" }] } } });
    await expect(yt.listChannels(auth, { fetch: m.fetch })).rejects.toMatchObject({ code: "permission_denied" });
  });
});
