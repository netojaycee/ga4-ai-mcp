import { beforeEach, describe, expect, it } from "vitest";
import { createAuthenticator } from "@/server/oauth/authenticate";
import { handleRevoke, handleToken } from "@/server/oauth/tokens";
import { BASE, MCP, REDIRECT, addClient, formReq, hashOf, makeHarness, type Harness } from "./fakes";
import { exchange, getCode, refresh, tokenReq } from "./flow";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
  addClient(h);
});

const bearer = (t: string) => new Request(`${MCP}`, { headers: { authorization: `Bearer ${t}` } });
const authn = () => createAuthenticator(h.deps.tokens, () => MCP, h.deps.now);

describe("authorization_code grant", () => {
  it("exchanges a code for hashed access + refresh tokens", async () => {
    const code = await getCode(h);
    const r = await exchange(h, code);
    expect(r.status).toBe(200);
    expect(r.headers.get("cache-control")).toBe("no-store");
    expect(r.body).toMatchObject({ token_type: "Bearer", expires_in: 3600 });
    expect(h.tokens.has(r.body.access_token)).toBe(false);
    expect(h.tokens.get(hashOf(r.body.access_token))?.kind).toBe("access");
    const rt = h.tokens.get(hashOf(r.body.refresh_token))!;
    expect(rt.expiresAt.getTime() - h.clock.now.getTime()).toBe(30 * 24 * 3600 * 1000);
    expect(await authn()(bearer(r.body.access_token))).toMatchObject({ clientId: "client-1" });
  });

  it("rejects missing verifier, wrong verifier", async () => {
    const c1 = await getCode(h);
    expect((await exchange(h, c1, { code_verifier: "" })).status).toBe(400);
    const c2 = await getCode(h);
    const r = await exchange(h, c2, { code_verifier: "w".repeat(50) });
    expect(r.body.error).toBe("invalid_grant");
    // the failed attempt burned the code
    expect((await exchange(h, c2)).body.error).toBe("invalid_grant");
  });

  it("rejects redirect_uri mismatch and absence", async () => {
    const c1 = await getCode(h);
    expect((await exchange(h, c1, { redirect_uri: "https://evil.example/cb" })).body.error).toBe("invalid_grant");
    const c2 = await getCode(h);
    const res = await handleToken(h.deps, tokenReq({ grant_type: "authorization_code", client_id: "client-1", code: c2, code_verifier: "v".repeat(50) }));
    expect((await res.json()).error).toBe("invalid_grant");
  });

  it("a valid access token is rejected by a server whose /mcp URL differs (audience confusion)", async () => {
    const r = await exchange(h, await getCode(h));
    const token = r.body.access_token;
    expect(await authn()(bearer(token))).not.toBeNull(); // sanity: valid for our own /mcp
    const other = createAuthenticator(h.deps.tokens, () => "https://other-service.example/mcp", h.deps.now);
    expect(await other(bearer(token))).toBeNull();
    const lookalike = createAuthenticator(h.deps.tokens, () => `${MCP}/extra`, h.deps.now);
    expect(await lookalike(bearer(token))).toBeNull();
  });

  it("rejects resource mismatch", async () => {
    const code = await getCode(h);
    const r = await exchange(h, code, { resource: "https://other.example/mcp" });
    expect(r.body.error).toBe("invalid_target");
  });

  it("rejects expired codes", async () => {
    const code = await getCode(h);
    h.clock.now = new Date(h.clock.now.getTime() + 5 * 60 * 1000 + 1);
    expect((await exchange(h, code)).body.error).toBe("invalid_grant");
  });

  it("rejects a code presented by another client", async () => {
    addClient(h, { clientId: "client-2" });
    const code = await getCode(h);
    expect((await exchange(h, code, { client_id: "client-2" })).body.error).toBe("invalid_grant");
  });

  it("unknown client and bad grant type", async () => {
    const code = await getCode(h);
    expect((await exchange(h, code, { client_id: "zzz" })).status).toBe(401);
    const res = await handleToken(h.deps, tokenReq({ grant_type: "password" }));
    expect((await res.json()).error).toBe("unsupported_grant_type");
    const bad = await handleToken(h.deps, new Request(`${BASE}/oauth/token`, { method: "POST", body: "{}", headers: { "content-type": "application/json" } }));
    expect(bad.status).toBe(400);
  });

  it("code replay revokes tokens issued from that code", async () => {
    const code = await getCode(h);
    const first = await exchange(h, code);
    expect(await authn()(bearer(first.body.access_token))).not.toBeNull();
    const replay = await exchange(h, code);
    expect(replay.body.error).toBe("invalid_grant");
    expect(await authn()(bearer(first.body.access_token))).toBeNull();
    expect((await refresh(h, first.body.refresh_token)).body.error).toBe("invalid_grant");
  });
});

describe("refresh_token grant", () => {
  it("rotates: new pair works, old refresh token is dead", async () => {
    const first = (await exchange(h, await getCode(h))).body;
    const second = await refresh(h, first.refresh_token);
    expect(second.status).toBe(200);
    expect(second.body.refresh_token).not.toBe(first.refresh_token);
    expect(await authn()(bearer(second.body.access_token))).not.toBeNull();
  });

  it("reuse of a rotated token revokes the whole chain", async () => {
    const first = (await exchange(h, await getCode(h))).body;
    const second = (await refresh(h, first.refresh_token)).body;
    const third = (await refresh(h, second.refresh_token)).body;
    // attacker replays the first (already rotated) token
    expect((await refresh(h, first.refresh_token)).body.error).toBe("invalid_grant");
    expect((await refresh(h, third.refresh_token)).body.error).toBe("invalid_grant");
    for (const t of [first, second, third]) expect(await authn()(bearer(t.access_token))).toBeNull();
  });

  it("does not touch other chains of the same user", async () => {
    const a = (await exchange(h, await getCode(h))).body;
    const b = (await exchange(h, await getCode(h))).body;
    await refresh(h, a.refresh_token);
    await refresh(h, a.refresh_token); // reuse
    expect(await authn()(bearer(b.access_token))).not.toBeNull();
  });

  it("rejects expired refresh tokens, wrong client, resource mismatch, scope escalation, access tokens", async () => {
    addClient(h, { clientId: "client-2" });
    const t = (await exchange(h, await getCode(h))).body;
    expect((await refresh(h, t.refresh_token, { client_id: "client-2" })).body.error).toBe("invalid_grant");
    expect((await refresh(h, t.refresh_token, { resource: "https://other.example/mcp" })).body.error).toBe("invalid_target");
    expect((await refresh(h, t.refresh_token, { scope: "analytics:read admin" })).body.error).toBe("invalid_scope");
    expect((await refresh(h, t.access_token)).body.error).toBe("invalid_grant");
    h.clock.now = new Date(h.clock.now.getTime() + 31 * 24 * 3600 * 1000);
    expect((await refresh(h, t.refresh_token)).body.error).toBe("invalid_grant");
  });
});

describe("access token validation", () => {
  it("rejects expired, revoked, wrong-audience, refresh-kind, malformed and unknown tokens", async () => {
    const t = (await exchange(h, await getCode(h))).body;
    expect(await authn()(bearer(t.refresh_token))).toBeNull();
    expect(await authn()(bearer("unknown"))).toBeNull();
    expect(await authn()(new Request(MCP))).toBeNull();
    expect(await authn()(new Request(MCP, { headers: { authorization: `Basic ${t.access_token}` } }))).toBeNull();
    expect(await authn()(new Request(`${MCP}?access_token=${t.access_token}`))).toBeNull();

    h.tokens.get(hashOf(t.access_token))!.resource = "https://other.example/mcp";
    expect(await authn()(bearer(t.access_token))).toBeNull();
    h.tokens.get(hashOf(t.access_token))!.resource = MCP;
    expect(await authn()(bearer(t.access_token))).not.toBeNull();

    h.tokens.get(hashOf(t.access_token))!.revokedAt = new Date();
    expect(await authn()(bearer(t.access_token))).toBeNull();
    h.tokens.get(hashOf(t.access_token))!.revokedAt = null;

    h.clock.now = new Date(h.clock.now.getTime() + 3600 * 1000);
    expect(await authn()(bearer(t.access_token))).toBeNull();
  });
});

describe("revocation", () => {
  it("revoking a refresh token kills the chain; unknown tokens still 200", async () => {
    const t = (await exchange(h, await getCode(h))).body;
    const res = await handleRevoke(h.deps, formReq(`${BASE}/oauth/revoke`, { token: t.refresh_token, client_id: "client-1" }));
    expect(res.status).toBe(200);
    expect(await authn()(bearer(t.access_token))).toBeNull();
    expect((await refresh(h, t.refresh_token)).body.error).toBe("invalid_grant");
    const unk = await handleRevoke(h.deps, formReq(`${BASE}/oauth/revoke`, { token: "nope" }));
    expect(unk.status).toBe(200);
  });

  it("another client cannot revoke our tokens", async () => {
    addClient(h, { clientId: "client-2" });
    const t = (await exchange(h, await getCode(h))).body;
    await handleRevoke(h.deps, formReq(`${BASE}/oauth/revoke`, { token: t.access_token, client_id: "client-2" }));
    expect(await authn()(bearer(t.access_token))).not.toBeNull();
    expect(REDIRECT).toBeTruthy();
  });
});
