import { describe, expect, it } from "vitest";
import { createMcpHandler } from "@/server/mcp/handler";
import { createAccountStatusTool } from "@/server/mcp/tools/account";
import { ctx, fakeStore, makeDeps, makeUser } from "./helpers";

const BASE = "https://example.test";
const RM = `Bearer resource_metadata="${BASE}/.well-known/oauth-protected-resource"`;

const post = (body: unknown, headers: Record<string, string> = {}) =>
  new Request("http://localhost/mcp", {
    method: "POST",
    headers: { "content-type": "application/json", accept: "application/json, text/event-stream", ...headers },
    body: JSON.stringify(body),
  });

function build(authed: boolean) {
  const store = fakeStore();
  const { deps, usage } = makeDeps(makeUser({ plan: "internal" }), { rateStore: store });
  const tool = createAccountStatusTool({
    rateStore: () => store,
    googleEmail: async () => ({ email: "g@example.com", status: "active" }),
  });
  const handle = createMcpHandler({
    authenticate: async (r) => (authed || r.headers.get("x-ok") ? ctx : null),
    publicBaseUrl: () => BASE,
    tools: [tool],
    wrapperDeps: deps,
  });
  return { handle, usage };
}

describe("/mcp handler", () => {
  it("answers 401 with WWW-Authenticate resource_metadata when unauthenticated", async () => {
    const { handle } = build(false);
    const res = await handle(post({ jsonrpc: "2.0", id: 1, method: "tools/list" }));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(RM);
    expect(res.headers.get("access-control-expose-headers")).toMatch(/WWW-Authenticate/);
  });

  it("answers 401 when the authenticator rejects an invalid token", async () => {
    const { handle } = build(false);
    const res = await handle(post({}, { authorization: "Bearer bogus" }));
    expect(res.status).toBe(401);
  });

  it("returns 500 (not 401) if the authenticator throws", async () => {
    const handle = createMcpHandler({
      authenticate: async () => { throw new Error("db"); },
      publicBaseUrl: () => BASE,
    });
    const res = await handle(post({}));
    expect(res.status).toBe(500);
  });

  it("handles CORS preflight without auth", async () => {
    const { handle } = build(false);
    const res = await handle(new Request("http://localhost/mcp", { method: "OPTIONS" }));
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-headers")).toMatch(/Authorization/);
  });

  it("serves initialize, tools/list and an account_status call end to end", async () => {
    const { handle, usage } = build(true);
    const init = await handle(
      post({
        jsonrpc: "2.0", id: 1, method: "initialize",
        params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } },
      }),
    );
    expect(init.status).toBe(200);

    const list = await (await handle(post({ jsonrpc: "2.0", id: 2, method: "tools/list" }))).json();
    expect(list.result.tools.map((t: { name: string }) => t.name)).toEqual(["account_status"]);
    expect(list.result.tools[0].annotations.readOnlyHint).toBe(true);

    const call = await (
      await handle(post({ jsonrpc: "2.0", id: 3, method: "tools/call", params: { name: "account_status", arguments: {} } }))
    ).json();
    expect(call.result.isError).toBeFalsy();
    expect(call.result.structuredContent).toMatchObject({
      plan: "internal", googleEmail: "g@example.com", dailyCallsRemaining: 4999,
    });
    expect(usage).toHaveLength(1);
    expect(usage[0]).toMatchObject({ tool: "account_status", ok: true });
  });
});

describe("/mcp unauthenticated throttle", () => {
  const mk = (limit: () => Promise<{ allowed: boolean; retryAfterSeconds: number }>) =>
    createMcpHandler({ authenticate: async () => null, publicBaseUrl: () => BASE, limitUnauthenticated: limit });

  it("answers 429 with Retry-After once a source is over the limit, instead of 401", async () => {
    const res = await mk(async () => ({ allowed: false, retryAfterSeconds: 77 }))(post({}));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("77");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });

  it("still answers a normal 401 (with WWW-Authenticate) while under the limit", async () => {
    const res = await mk(async () => ({ allowed: true, retryAfterSeconds: 0 }))(post({}));
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toBe(RM);
  });

  it("a failing limiter degrades to a plain 401 (never 500, never lets the request through)", async () => {
    const res = await mk(async () => { throw new Error("db down"); })(post({}));
    expect(res.status).toBe(401);
  });

  it("does not count or limit authenticated requests", async () => {
    let calls = 0;
    const handle = createMcpHandler({
      authenticate: async () => ctx,
      publicBaseUrl: () => BASE,
      limitUnauthenticated: async () => { calls++; return { allowed: false, retryAfterSeconds: 1 }; },
    });
    const res = await handle(post({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "t", version: "1" } } }));
    expect(res.status).not.toBe(429);
    expect(calls).toBe(0);
  });
});
