import { describe, expect, it } from "vitest";
import { STATE_COOKIE, handleCallback, handleStart } from "@/server/connect/flow";
import { GOOGLE_SCOPE_ANALYTICS, GOOGLE_SCOPE_SEARCH_CONSOLE, parseIdToken } from "@/server/connect/google";
import { SESSION_COOKIE } from "@/server/auth/session";
import { BASE, CLIENT_ID, FakeGoogle, FakeRepo, NOW, cookieFrom, idToken, makeDeps } from "./fakes";

function begin(deps = makeDeps(), returnTo = "/oauth/authorize?x=1") {
  const res = handleStart(new Request(`${BASE}/api/connect/google/start?return_to=${encodeURIComponent(returnTo)}`), deps);
  const loc = new URL(res.headers.get("location")!);
  return { res, loc, state: loc.searchParams.get("state")!, cookie: cookieFrom(res, STATE_COOKIE) };
}

const callback = (deps: ReturnType<typeof makeDeps>, qs: string, cookie?: string) =>
  handleCallback(new Request(`${BASE}/api/connect/google/callback?${qs}`, { headers: cookie ? { cookie } : {} }), deps);

describe("handleStart", () => {
  it("redirects to Google with offline access, consent, PKCE and the right redirect uri", () => {
    const { res, loc, cookie } = begin();
    expect(res.status).toBe(302);
    expect(loc.origin + loc.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    const p = loc.searchParams;
    expect(p.get("access_type")).toBe("offline");
    expect(p.get("prompt")).toBe("consent");
    expect(p.get("include_granted_scopes")).toBe("true");
    expect(p.get("code_challenge_method")).toBe("S256");
    expect(p.get("code_challenge")).toBeTruthy();
    expect(p.get("redirect_uri")).toBe(`${BASE}/api/connect/google/callback`);
    expect(p.get("response_type")).toBe("code");
    expect(p.get("scope")!.split(" ").sort()).toEqual(
      ["email", "openid", "profile", GOOGLE_SCOPE_ANALYTICS, GOOGLE_SCOPE_SEARCH_CONSOLE].sort(),
    );
    const setCookie = res.headers.getSetCookie()[0];
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toMatch(/Secure/);
    expect(cookie.length).toBeGreaterThan(20);
  });
});

describe("handleCallback", () => {
  it("new user: creates user with trial, stores only the encrypted token, sets session, redirects to return_to", async () => {
    const repo = new FakeRepo();
    const google = new FakeGoogle();
    const deps = makeDeps(repo, google);
    const { state, cookie } = begin(deps, "/oauth/authorize?x=1");
    const res = await callback(deps, `code=abc&state=${state}`, cookie);

    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe(`${BASE}/oauth/authorize?x=1`);
    expect(res.headers.getSetCookie().some((c) => c.startsWith(`${SESSION_COOKIE}=`) && /HttpOnly/.test(c))).toBe(true);

    const [user] = [...repo.users.values()];
    expect(user.plan).toBe("trial");
    expect(user.trialEndsAt!.getTime()).toBe(NOW + 14 * 86_400_000);
    const conn = repo.connections.get(user.id)!;
    expect(conn.refreshTokenEnc).toBe("v1.enc(refresh-secret)");
    expect(conn.encKeyVersion).toBe(1);
    expect(JSON.stringify([...repo.connections.values()])).not.toMatch(/"refresh-secret"/);
    expect(conn.scopes).toContain(GOOGLE_SCOPE_ANALYTICS);
    expect(google.exchanged[0].codeVerifier.length).toBeGreaterThan(40);
    expect(repo.audits[0].action).toBe("google.connect");
  });

  it("existing user: updates email/name/last seen, keeps plan and trial", async () => {
    const repo = new FakeRepo();
    const deps = makeDeps(repo);
    let r = begin(deps);
    await callback(deps, `code=a&state=${r.state}`, r.cookie);
    const user = [...repo.users.values()][0];
    user.plan = "paid";
    user.trialEndsAt = null;

    const g = deps.google as FakeGoogle;
    g.tokens = { ...g.tokens, idToken: idToken({ email: "new@example.com", name: "New Name" }) };
    const later = makeDeps(repo, g, { now: () => NOW + 1000 });
    r = begin(later);
    await callback(later, `code=b&state=${r.state}`, r.cookie);

    expect(repo.users.size).toBe(1);
    expect(user.email).toBe("new@example.com");
    expect(user.name).toBe("New Name");
    expect(user.plan).toBe("paid");
    expect(user.trialEndsAt).toBeNull();
    expect(user.lastSeenAt.getTime()).toBe(NOW + 1000);
    expect(repo.connections.size).toBe(1);
  });

  it("rejects a state mismatch without exchanging the code", async () => {
    const google = new FakeGoogle();
    const deps = makeDeps(new FakeRepo(), google);
    const { cookie } = begin(deps);
    const res = await callback(deps, "code=abc&state=wrong", cookie);
    expect(res.status).toBe(400);
    expect(google.exchanged).toHaveLength(0);
    expect(res.headers.getSetCookie().join()).not.toContain(`${SESSION_COOKIE}=`);
  });

  it("rejects missing state cookie or missing state param", async () => {
    const google = new FakeGoogle();
    const deps = makeDeps(new FakeRepo(), google);
    const { state, cookie } = begin(deps);
    expect((await callback(deps, `code=abc&state=${state}`)).status).toBe(400);
    expect((await callback(deps, "code=abc", cookie)).status).toBe(400);
    expect(google.exchanged).toHaveLength(0);
  });

  it("rejects an expired state cookie", async () => {
    const deps = makeDeps();
    const { state, cookie } = begin(deps);
    const late = makeDeps(deps.repo as FakeRepo, deps.google as FakeGoogle, { now: () => NOW + 11 * 60_000 });
    expect((await callback(late, `code=abc&state=${state}`, cookie)).status).toBe(400);
  });

  it("shows a friendly page on access_denied", async () => {
    const deps = makeDeps();
    const { state, cookie } = begin(deps);
    const res = await callback(deps, `error=access_denied&state=${state}`, cookie);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("not granted");
  });

  it("requires a refresh token", async () => {
    const repo = new FakeRepo();
    const google = new FakeGoogle();
    google.tokens = { ...google.tokens, refreshToken: undefined };
    const deps = makeDeps(repo, google);
    const { state, cookie } = begin(deps);
    const res = await callback(deps, `code=abc&state=${state}`, cookie);
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("refresh token");
    expect(repo.users.size).toBe(0);
  });

  it.each([GOOGLE_SCOPE_ANALYTICS, GOOGLE_SCOPE_SEARCH_CONSOLE])("requires scope %s", async (dropped) => {
    const repo = new FakeRepo();
    const google = new FakeGoogle();
    google.tokens = { ...google.tokens, scope: google.tokens.scope.split(" ").filter((s) => s !== dropped).join(" ") };
    const deps = makeDeps(repo, google);
    const { state, cookie } = begin(deps);
    const res = await callback(deps, `code=abc&state=${state}`, cookie);
    const body = await res.text();
    expect(res.status).toBe(400);
    expect(body).toContain("Permissions missing");
    expect(body).toContain("Try connecting again");
    expect(repo.users.size).toBe(0);
    expect(res.headers.getSetCookie().join()).not.toContain(`${SESSION_COOKIE}=${"a"}`);
  });

  it("never reflects an open redirect return_to", async () => {
    const deps = makeDeps();
    const { state, cookie } = begin(deps, "//evil.com");
    const res = await callback(deps, `code=abc&state=${state}`, cookie);
    expect(res.headers.get("location")).toBe(`${BASE}/account`);
  });
});

describe("parseIdToken", () => {
  const now = Math.floor(NOW / 1000);
  it("accepts a valid token", () => {
    expect(parseIdToken(idToken(), CLIENT_ID, now)).toEqual({ sub: "sub-1", email: "a@example.com", name: "Ann" });
  });
  it("rejects wrong audience, issuer, expiry and shape", () => {
    expect(() => parseIdToken(idToken({ aud: "other" }), CLIENT_ID, now)).toThrow(/audience/);
    expect(() => parseIdToken(idToken({ iss: "https://evil.com" }), CLIENT_ID, now)).toThrow(/issuer/);
    expect(() => parseIdToken(idToken({ exp: now - 1 }), CLIENT_ID, now)).toThrow(/expired/);
    expect(() => parseIdToken("nope", CLIENT_ID, now)).toThrow();
    expect(() => parseIdToken(idToken({ sub: "" }), CLIENT_ID, now)).toThrow();
  });
  it("fails the callback when the id token is invalid", async () => {
    const repo = new FakeRepo();
    const google = new FakeGoogle();
    google.tokens = { ...google.tokens, idToken: idToken({ aud: "other" }) };
    const deps = makeDeps(repo, google);
    const { state, cookie } = begin(deps);
    const res = await callback(deps, `code=abc&state=${state}`, cookie);
    expect(res.status).toBe(502);
    expect(repo.users.size).toBe(0);
  });
});
