import { describe, expect, it } from "vitest";
import { STATE_COOKIE, handleCallback, handleStart } from "@/server/connect/flow";
import { deleteUserData, handleLogout } from "@/server/connect/account";
import { signPayload } from "@/server/connect/signed";
import { SESSION_COOKIE, createSessionCookie, csrfTokenFor, getSessionUser } from "@/server/auth/session";
import { sha256Hex } from "@/server/security/hash";
import { BASE, FakeGoogle, FakeRepo, NOW, SECRET, cookieFrom, idToken, makeDeps } from "./fakes";

const DAY = 86_400_000;

async function signIn(deps: ReturnType<typeof makeDeps>) {
  const start = handleStart(new Request(`${BASE}/api/connect/google/start?return_to=%2Faccount`), deps);
  const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
  const cookie = cookieFrom(start, STATE_COOKIE);
  return handleCallback(new Request(`${BASE}/api/connect/google/callback?code=c&state=${state}`, { headers: { cookie } }), deps);
}
const accountDeps = (repo: FakeRepo, google = new FakeGoogle()) => ({ google, repo, decrypt: (p: string) => p, now: () => NOW });

describe("deleting data cannot be used to reset a trial or lift a suspension", () => {
  it("an expired trial stays expired after delete + sign in again", async () => {
    const repo = new FakeRepo();
    expect((await signIn(makeDeps(repo))).status).toBe(302);
    const user = [...repo.users.values()][0];
    user.trialEndsAt = new Date(NOW - DAY); // expired yesterday
    await deleteUserData(accountDeps(repo), user.id);
    expect(repo.users.size).toBe(0);

    expect((await signIn(makeDeps(repo, new FakeGoogle(), { now: () => NOW + 5000 }))).status).toBe(302);
    const again = [...repo.users.values()][0];
    expect(again.plan).toBe("trial");
    expect(again.trialEndsAt!.getTime()).toBe(NOW - DAY); // NOT a fresh 14-day window
  });

  it("a suspended user stays suspended", async () => {
    const repo = new FakeRepo();
    await signIn(makeDeps(repo));
    const user = [...repo.users.values()][0];
    user.plan = "suspended";
    await deleteUserData(accountDeps(repo), user.id);
    await signIn(makeDeps(repo));
    expect([...repo.users.values()][0].plan).toBe("suspended");
  });

  it("a paid/internal plan is restored too, and an explicit admin grant still wins over the tombstone", async () => {
    const repo = new FakeRepo();
    await signIn(makeDeps(repo));
    const u = [...repo.users.values()][0];
    u.plan = "paid";
    u.trialEndsAt = null;
    await deleteUserData(accountDeps(repo), u.id);
    repo.grants.set("a@example.com", { plan: "internal", appliedAt: null });
    await signIn(makeDeps(repo));
    expect([...repo.users.values()][0].plan).toBe("internal"); // grant beats tombstone
  });

  it("stores only a one-way hash of the Google sub in the tombstone, never email or name", async () => {
    const repo = new FakeRepo();
    await signIn(makeDeps(repo));
    const u = [...repo.users.values()][0];
    await deleteUserData(accountDeps(repo), u.id);
    expect([...repo.tombstones.keys()]).toEqual([sha256Hex("sub-1")]);
    expect(JSON.stringify([...repo.tombstones.entries()])).not.toMatch(/example\.com|Ann/);
  });

  it("delete also purges pre-approvals for the user's email and audit rows about them", async () => {
    const repo = new FakeRepo();
    await signIn(makeDeps(repo));
    const u = [...repo.users.values()][0];
    repo.grants.set("a@example.com", { plan: "internal", appliedAt: new Date(NOW) });
    await deleteUserData(accountDeps(repo), u.id);
    expect(repo.grants.has("a@example.com")).toBe(false);
    expect(repo.audits.filter((a) => a.target === u.id || a.actor === `user:${u.id}`)).toEqual([]);
  });
});

describe("email_verified", () => {
  async function tryWith(claims: Record<string, unknown>) {
    const repo = new FakeRepo();
    const google = new FakeGoogle();
    google.tokens = { ...google.tokens, idToken: idToken(claims) };
    const res = await signIn(makeDeps(repo, google));
    return { res, repo };
  }

  it("refuses sign-in when Google says the email is not verified, and creates no user", async () => {
    const { res, repo } = await tryWith({ email_verified: false });
    expect(res.status).toBe(403);
    expect(await res.text()).toMatch(/not verified/i);
    expect(repo.users.size).toBe(0);
    expect(repo.connections.size).toBe(0);
  });

  it("refuses when the claim is missing entirely, or the string 'false'", async () => {
    for (const claims of [{ email_verified: undefined }, { email_verified: "false" }]) {
      const { res, repo } = await tryWith(claims);
      expect(res.status).toBe(403);
      expect(repo.users.size).toBe(0);
    }
  });

  it("accepts true and the string 'true'", async () => {
    for (const v of [true, "true"]) {
      const { res, repo } = await tryWith({ email_verified: v });
      expect(res.status).toBe(302);
      expect(repo.users.size).toBe(1);
    }
  });
});

describe("session hardening", () => {
  const base = { secret: () => SECRET, now: () => NOW };
  const withCookie = (c: string) => new Request("https://x.test/", { headers: { cookie: c.split(";")[0] } });

  it("a validly signed cookie of another type (or no type) is not a session", async () => {
    const exp = Math.floor(NOW / 1000) + 600;
    for (const payload of [
      { typ: "oauth_state", uid: "u1", email: "a@x.com", exp },
      { uid: "u1", email: "a@x.com", exp },
    ]) {
      const cookie = `${SESSION_COOKIE}=${signPayload(payload, SECRET)}`;
      expect(await getSessionUser(withCookie(cookie), { ...base, userExists: async () => true })).toBeNull();
    }
  });

  it("sessions issued before auth_valid_after are rejected; newer ones survive", async () => {
    const cookie = createSessionCookie({ userId: "u1", email: "a@x.com" }, base);
    const state = (authValidAfter: Date | null) => async () => ({ email: "a@x.com", authValidAfter });
    expect(await getSessionUser(withCookie(cookie), { ...base, userState: state(null) })).not.toBeNull();
    expect(await getSessionUser(withCookie(cookie), { ...base, userState: state(new Date(NOW - 1000)) })).not.toBeNull();
    expect(await getSessionUser(withCookie(cookie), { ...base, userState: state(new Date(NOW + 1000)) })).toBeNull();
  });

  it("returns the email from the database, not the stale one inside the cookie", async () => {
    const cookie = createSessionCookie({ userId: "u1", email: "old-admin@x.com" }, base);
    const s = await getSessionUser(withCookie(cookie), { ...base, userState: async () => ({ email: "new@x.com", authValidAfter: null }) });
    expect(s).toEqual({ userId: "u1", email: "new@x.com" });
  });

  it("a user deleted from the database has no session", async () => {
    const cookie = createSessionCookie({ userId: "u1", email: "a@x.com" }, base);
    expect(await getSessionUser(withCookie(cookie), { ...base, userState: async () => null })).toBeNull();
  });
});

describe("OAuth state cookie typing", () => {
  it("a signed state cookie without the right type is rejected as an invalid sign-in", async () => {
    const deps = makeDeps();
    const exp = Math.floor(NOW / 1000) + 600;
    const bad = `${STATE_COOKIE}=${signPayload({ state: "s", verifier: "v", returnTo: "/account", exp }, SECRET)}`;
    const res = await handleCallback(new Request(`${BASE}/api/connect/google/callback?code=c&state=s`, { headers: { cookie: bad } }), deps);
    expect(res.status).toBe(400);
    expect(await res.text()).toMatch(/expired or invalid/i);
    // and a session cookie cannot stand in for a state cookie
    const sess = createSessionCookie({ userId: "u1", email: "a@x.com" }, { secret: () => SECRET, now: () => NOW }).split(";")[0].split("=")[1];
    const res2 = await handleCallback(new Request(`${BASE}/api/connect/google/callback?code=c&state=s`, { headers: { cookie: `${STATE_COOKIE}=${sess}` } }), deps);
    expect(res2.status).toBe(400);
  });
});

describe("logout", () => {
  const d = { baseUrl: BASE, sessionSecret: SECRET };
  const sessionCookie = createSessionCookie({ userId: "u1", email: "a@x.com" }, { secret: () => SECRET, now: () => NOW }).split(";")[0];
  const form = (fields: Record<string, string>, headers: Record<string, string>) =>
    new Request(`${BASE}/api/connect/logout`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded", cookie: sessionCookie, ...headers },
      body: new URLSearchParams(fields).toString(),
    });

  it("clears the session cookie with a valid CSRF token and same origin", async () => {
    const csrf = csrfTokenFor(sessionCookie, SECRET)!;
    const res = await handleLogout(form({ csrf }, { origin: BASE }), d);
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe(`${BASE}/account?msg=signedout`);
    expect(res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))).toContain("Max-Age=0");
  });

  it("rejects missing/wrong CSRF and cross-origin posts without clearing anything", async () => {
    const good = csrfTokenFor(sessionCookie, SECRET)!;
    for (const req of [form({}, {}), form({ csrf: "wrong" }, {}), form({ csrf: good }, { origin: "https://evil.example" })]) {
      const res = await handleLogout(req, d);
      expect(res.status).toBe(403);
      expect(res.headers.getSetCookie()).toEqual([]);
    }
  });
});
