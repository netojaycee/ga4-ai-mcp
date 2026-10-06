import { describe, expect, it } from "vitest";
import { handleAccountAction, type AccountDeps } from "@/server/connect/account";
import { SESSION_COOKIE, createSessionCookie, csrfTokenFor } from "@/server/auth/session";
import { BASE, FakeGoogle, FakeRepo, NOW, SECRET } from "./fakes";

async function setup() {
  const repo = new FakeRepo();
  const google = new FakeGoogle();
  const { id } = await repo.upsertUser({
    googleSub: "sub-1",
    email: "a@example.com",
    name: "Ann",
    now: new Date(NOW),
    newUser: { plan: "trial", trialEndsAt: null },
  });
  await repo.upsertConnection({
    userId: id,
    googleSub: "sub-1",
    googleEmail: "a@example.com",
    refreshTokenEnc: "v1.enc(refresh-secret)",
    encKeyVersion: 1,
    scopes: [],
    now: new Date(NOW),
  });
  repo.tokens.push({ userId: id, revokedAt: null }, { userId: id, revokedAt: null }, { userId: "other", revokedAt: null });
  const deps: AccountDeps = {
    google,
    repo,
    baseUrl: BASE,
    sessionSecret: SECRET,
    decrypt: (p) => p.replace(/^v1\.enc\((.*)\)$/, "$1"),
    now: () => NOW,
  };
  const cookie = createSessionCookie({ userId: id, email: "a@example.com" }, { secret: () => SECRET, now: () => NOW }).split(";")[0];
  return { repo, google, deps, id, cookie };
}

function post(cookie: string | null, fields: Record<string, string>, headers: Record<string, string> = {}) {
  return new Request(`${BASE}/api/connect/account/x`, {
    method: "POST",
    headers: { ...(cookie ? { cookie } : {}), ...headers },
    body: new URLSearchParams(fields),
  });
}

describe("account actions", () => {
  it("disconnect revokes at Google, deletes the connection, revokes our tokens and audits", async () => {
    const { repo, google, deps, id, cookie } = await setup();
    const csrf = csrfTokenFor(cookie, SECRET)!;
    const res = await handleAccountAction(post(cookie, { csrf }, { origin: BASE }), deps, "disconnect");

    expect(res.status).toBe(303);
    expect(google.revoked).toEqual(["refresh-secret"]);
    expect(repo.connections.has(id)).toBe(false);
    expect(repo.users.has(id)).toBe(true);
    expect(repo.tokens.filter((t) => t.userId === id).every((t) => t.revokedAt)).toBe(true);
    expect(repo.tokens.find((t) => t.userId === "other")!.revokedAt).toBeNull();
    expect(repo.audits.at(-1)).toMatchObject({ action: "account.disconnect", target: id, meta: { googleRevoked: true, revokedTokens: 2 } });
  });

  it("still disconnects locally when Google revocation fails", async () => {
    const { repo, google, deps, id, cookie } = await setup();
    google.revoke = async () => {
      throw new Error("boom");
    };
    const csrf = csrfTokenFor(cookie, SECRET)!;
    await handleAccountAction(post(cookie, { csrf }), deps, "disconnect");
    expect(repo.connections.has(id)).toBe(false);
    expect(repo.audits.at(-1)!.meta).toMatchObject({ googleRevoked: false });
  });

  it("delete removes the user, clears the session and audits", async () => {
    const { repo, deps, id, cookie } = await setup();
    const csrf = csrfTokenFor(cookie, SECRET)!;
    const res = await handleAccountAction(post(cookie, { csrf }, { origin: BASE }), deps, "delete");
    expect(res.status).toBe(303);
    expect(repo.users.has(id)).toBe(false);
    expect(repo.audits.at(-1)).toMatchObject({ action: "account.delete" });
    const cleared = res.headers.getSetCookie().find((c) => c.startsWith(`${SESSION_COOKIE}=`))!;
    expect(cleared).toContain("Max-Age=0");
  });

  it("rejects missing, wrong and cross-session CSRF tokens and cross-origin posts", async () => {
    const { repo, deps, id, cookie, google } = await setup();
    const good = csrfTokenFor(cookie, SECRET)!;
    const cases = [
      post(cookie, {}),
      post(cookie, { csrf: "wrong" }),
      post(cookie, { csrf: good }, { origin: "https://evil.com" }),
      post(`${SESSION_COOKIE}=other.sig`, { csrf: good }),
    ];
    for (const req of cases) {
      const res = await handleAccountAction(req, deps, "delete");
      expect([403, 303]).toContain(res.status);
      expect(res.status === 403 || res.headers.get("location") === `${BASE}/account`).toBe(true);
    }
    expect(repo.users.has(id)).toBe(true);
    expect(repo.connections.has(id)).toBe(true);
    expect(google.revoked).toHaveLength(0);
  });

  it("does nothing without a session", async () => {
    const { repo, deps, id } = await setup();
    const res = await handleAccountAction(post(null, { csrf: "x" }), deps, "delete");
    expect(res.status).toBe(303);
    expect(repo.users.has(id)).toBe(true);
  });
});
