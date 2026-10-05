import { afterEach, describe, expect, it, vi } from "vitest";
import { ToolError } from "@/server/errors";
import { runTool } from "@/server/mcp/wrapper";
import { ctx, makeDeps, makeUser, NOW } from "./helpers";

const text = (r: { content: unknown }) => (r.content as { text: string }[])[0].text;

afterEach(() => vi.restoreAllMocks());

describe("runTool", () => {
  it("runs the handler with ctx, user and limits and logs a successful usage event", async () => {
    const { deps, usage } = makeDeps(makeUser());
    const handler = vi.fn(async (tc) => ({ text: "hi", target: "properties/1", rows: 7, structured: { a: tc.limits.perMinute } }));
    const res = await runTool("t", ctx, handler, deps);
    expect(res.isError).toBeUndefined();
    expect(text(res)).toBe("hi");
    expect(res.structuredContent).toEqual({ a: 40 });
    expect(handler.mock.calls[0][0].user.plan).toBe("paid");
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({
      tool: "t", target: "properties/1", rows: 7, ok: true, errorCode: null, clientId: "client-1", userId: ctx.userId,
    });
    expect(usage[0].latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("blocks a suspended user without calling the handler, and logs it", async () => {
    const { deps, usage } = makeDeps(makeUser({ plan: "suspended" }));
    const handler = vi.fn();
    const res = await runTool("t", ctx, handler, deps);
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/suspended/);
    expect(handler).not.toHaveBeenCalled();
    expect(usage[0]).toMatchObject({ ok: false, errorCode: "plan_blocked" });
  });

  it("blocks an expired trial", async () => {
    const { deps } = makeDeps(makeUser({ plan: "trial", trialEndsAt: new Date(NOW.getTime() - 1000) }));
    const res = await runTool("t", ctx, vi.fn(), deps);
    expect(text(res)).toMatch(/trial has ended/i);
  });

  it("rate limits once the per-minute cap is hit", async () => {
    const { deps, usage } = makeDeps(makeUser({ plan: "trial", trialEndsAt: new Date(NOW.getTime() + 86_400_000) }));
    const handler = vi.fn(async () => ({ text: "ok" }));
    for (let i = 0; i < 20; i++) expect((await runTool("t", ctx, handler, deps)).isError).toBeUndefined();
    const res = await runTool("t", ctx, handler, deps);
    expect(res.isError).toBe(true);
    expect(text(res)).toMatch(/per minute/);
    expect(handler).toHaveBeenCalledTimes(20);
    expect(usage.at(-1)).toMatchObject({ ok: false, errorCode: "rate_limited" });
  });

  it("maps a handler ToolError to its userMessage", async () => {
    const { deps, usage } = makeDeps(makeUser());
    const res = await runTool("t", ctx, async () => { throw new ToolError("not_found", "No such property."); }, deps);
    expect(res).toEqual({ isError: true, content: [{ type: "text", text: "No such property." }] });
    expect(usage[0]).toMatchObject({ ok: false, errorCode: "not_found" });
  });

  it("does not leak unexpected error details", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps, usage } = makeDeps(makeUser());
    const res = await runTool("t", ctx, async () => { throw new Error("secret-token-abc at postgres://user:pw@host"); }, deps);
    expect(res.isError).toBe(true);
    expect(text(res)).not.toMatch(/secret|postgres|pw/);
    expect(usage[0]).toMatchObject({ ok: false, errorCode: "upstream_error" });
    const logged = JSON.stringify(vi.mocked(console.error).mock.calls);
    expect(logged).not.toMatch(/secret|postgres/);
  });

  it("reports auth_required when the user row is missing", async () => {
    const { deps, usage } = makeDeps(null);
    const res = await runTool("t", ctx, vi.fn(), deps);
    expect(res.isError).toBe(true);
    expect(usage[0]).toMatchObject({ userId: null, errorCode: "auth_required" });
  });

  it("still returns the result if usage logging fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { deps } = makeDeps(makeUser(), { logUsage: async () => { throw new Error("db down"); } });
    const res = await runTool("t", ctx, async () => ({ text: "fine" }), deps);
    expect(text(res)).toBe("fine");
  });
});
