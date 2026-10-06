import { describe, expect, it } from "vitest";
import { TOOLS } from "@/server/mcp/tools";
import { authenticateMcp } from "@/server/mcp/auth";

describe("tool registry", () => {
  it("registers account + 8 Google tools with unique snake_case names", () => {
    const names = TOOLS.map((t) => t.name);
    expect(names).toEqual([
      "account_status",
      "ga4_list_properties",
      "ga4_get_metadata",
      "ga4_run_report",
      "ga4_run_realtime_report",
      "gsc_list_sites",
      "gsc_search_analytics",
      "gsc_inspect_url",
      "gsc_list_sitemaps",
    ]);
    expect(new Set(names).size).toBe(names.length);
    for (const t of TOOLS) {
      expect(t.name).toMatch(/^[a-z][a-z0-9_]*$/);
      expect(t.description.length).toBeGreaterThan(40);
    }
  });
});

describe("authenticateMcp wiring", () => {
  it("rejects requests with no credentials without touching the database", async () => {
    expect(await authenticateMcp(new Request("https://x.test/mcp", { method: "POST" }))).toBeNull();
  });

  it("does not treat a malformed bearer header as authenticated", async () => {
    const req = new Request("https://x.test/mcp", { method: "POST", headers: { authorization: "Basic abc" } });
    expect(await authenticateMcp(req)).toBeNull();
  });
});
