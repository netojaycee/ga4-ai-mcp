import { describe, expect, it } from "vitest";
import { authorizationServerMetadata, protectedResourceMetadata } from "@/server/oauth/metadata";
import { handleRegister } from "@/server/oauth/register";
import { BASE, MCP, makeHarness } from "./fakes";

const reg = (body: unknown) =>
  new Request(`${BASE}/oauth/register`, { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json" } });

describe("metadata", () => {
  it("protected resource points at our AS and /mcp", () => {
    const m = protectedResourceMetadata(BASE, MCP);
    expect(m.resource).toBe(MCP);
    expect(m.authorization_servers).toEqual([BASE]);
  });
  it("AS metadata advertises S256 only, public clients, DCR and revocation", () => {
    const m = authorizationServerMetadata(BASE);
    expect(m.issuer).toBe(BASE);
    expect(m.code_challenge_methods_supported).toEqual(["S256"]);
    expect(m.token_endpoint_auth_methods_supported).toEqual(["none"]);
    expect(m.grant_types_supported).toEqual(["authorization_code", "refresh_token"]);
    expect(m.registration_endpoint).toBe(`${BASE}/oauth/register`);
    expect(m.revocation_endpoint).toBe(`${BASE}/oauth/revoke`);
  });
});

describe("dynamic client registration", () => {
  it("registers a public client with a random id", async () => {
    const h = makeHarness();
    const res = await handleRegister(h.deps, reg({ client_name: "X", redirect_uris: ["https://a.example/cb", "http://localhost:3000/cb", "http://127.0.0.1/cb", "http://[::1]:9/cb"] }));
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.token_endpoint_auth_method).toBe("none");
    expect(body.client_id).toMatch(/^c_/);
    expect(h.clients.size).toBe(1);
  });

  it.each([
    ["http non-loopback", "http://evil.example/cb"],
    ["fragment", "https://a.example/cb#x"],
    ["wildcard", "https://*.example.com/cb"],
    ["javascript scheme", "javascript:alert(1)"],
    ["custom scheme", "myapp://cb"],
    ["userinfo", "https://user:pw@a.example/cb"],
    ["not a url", "nope"],
    ["lookalike loopback", "http://localhost.evil.com/cb"],
  ])("rejects redirect uri: %s", async (_n, uri) => {
    const h = makeHarness();
    const res = await handleRegister(h.deps, reg({ redirect_uris: [uri] }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("invalid_redirect_uri");
    expect(h.clients.size).toBe(0);
  });

  it("caps counts and sizes, and rejects bad metadata", async () => {
    const h = makeHarness();
    const many = Array.from({ length: 11 }, (_, i) => `https://a.example/${i}`);
    expect((await handleRegister(h.deps, reg({ redirect_uris: many }))).status).toBe(400);
    expect((await handleRegister(h.deps, reg({ redirect_uris: ["https://a.example/" + "a".repeat(3000)] }))).status).toBe(400);
    expect((await handleRegister(h.deps, reg({ redirect_uris: ["https://a.example/c"], client_name: "n".repeat(101) }))).status).toBe(400);
    expect((await handleRegister(h.deps, reg({ redirect_uris: ["https://a.example/c"], grant_types: ["password"] }))).status).toBe(400);
    expect((await handleRegister(h.deps, reg({ redirect_uris: [] }))).status).toBe(400);
    expect((await handleRegister(h.deps, new Request(`${BASE}/oauth/register`, { method: "POST", body: "{nope" }))).status).toBe(400);
    expect((await handleRegister(h.deps, new Request(`${BASE}/oauth/register`, { method: "POST", body: "x".repeat(20000) }))).status).toBe(413);
  });

  it("forces auth method none even if a secret method is requested", async () => {
    const h = makeHarness();
    const res = await handleRegister(h.deps, reg({ redirect_uris: ["https://a.example/c"], token_endpoint_auth_method: "client_secret_basic" }));
    expect((await res.json()).token_endpoint_auth_method).toBe("none");
  });
});

describe("registration throttle", () => {
  it("returns 429 with Retry-After when the limiter blocks, and creates nothing", async () => {
    const h = makeHarness();
    h.deps.limitRegistration = async () => ({ allowed: false, retryAfterSeconds: 123 });
    const res = await handleRegister(h.deps, reg({ redirect_uris: ["https://a.example/cb"] }));
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("123");
    expect(h.clients.size).toBe(0);
  });
});

describe("native redirect allowlist", () => {
  it("accepts Cursor's exact native redirect alongside an https one in one registration", async () => {
    const h = makeHarness();
    const res = await handleRegister(
      h.deps,
      reg({ client_name: "Cursor", redirect_uris: ["cursor://anysphere.cursor-mcp/oauth/callback", "https://www.cursor.com/agents/mcp/oauth/callback"] }),
    );
    expect(res.status).toBe(201);
  });

  it("still rejects other custom schemes and near-miss variants of the allowed one", async () => {
    for (const uri of [
      "cursor://evil.example/oauth/callback",
      "cursor://anysphere.cursor-mcp/oauth/callback/extra",
      "cursor://anysphere.cursor-mcp/oauth/callback?x=1",
      "cursor://anysphere.cursor-mcp",
      "vscode://anything",
      "myapp://cb",
    ]) {
      const h = makeHarness();
      expect((await handleRegister(h.deps, reg({ redirect_uris: [uri] }))).status, uri).toBe(400);
    }
  });
});
