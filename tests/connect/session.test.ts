import { describe, expect, it } from "vitest";
import {
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  clearSessionCookie,
  connectStartPath,
  createSessionCookie,
  csrfTokenFor,
  getSessionUser,
  verifyCsrf,
} from "@/server/auth/session";
import { NOW, SECRET } from "./fakes";

const deps = (over = {}) => ({ secret: () => SECRET, now: () => NOW, userExists: async () => true, ...over });
const reqWith = (cookie: string) => new Request("https://x.test/", { headers: { cookie } });
const valueOf = (setCookie: string) => setCookie.split(";")[0];

describe("session cookie", () => {
  const setCookie = createSessionCookie({ userId: "u1", email: "a@x.com" }, deps());

  it("has the required attributes", () => {
    expect(setCookie).toMatch(/HttpOnly/);
    expect(setCookie).toMatch(/SameSite=Lax/);
    expect(setCookie).toContain(`Max-Age=${SESSION_TTL_SECONDS}`);
    expect(clearSessionCookie()).toContain("Max-Age=0");
  });

  it("round-trips", async () => {
    expect(await getSessionUser(reqWith(valueOf(setCookie)), deps())).toEqual({ userId: "u1", email: "a@x.com" });
  });

  it("is anonymous without a cookie", async () => {
    expect(await getSessionUser(new Request("https://x.test/"), deps())).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const [name, v] = valueOf(setCookie).split("=");
    const [body, sig] = v.split(".");
    const forged = Buffer.from(JSON.stringify({ uid: "admin", email: "a@x.com", exp: 9e9 })).toString("base64url");
    expect(await getSessionUser(reqWith(`${name}=${forged}.${sig}`), deps())).toBeNull();
    expect(await getSessionUser(reqWith(`${name}=${body}.AAAA`), deps())).toBeNull();
    expect(await getSessionUser(reqWith(`${name}=garbage`), deps())).toBeNull();
  });

  it("rejects a cookie signed with another secret", async () => {
    expect(await getSessionUser(reqWith(valueOf(setCookie)), deps({ secret: () => "z".repeat(40) }))).toBeNull();
  });

  it("rejects after expiry", async () => {
    const later = NOW + (SESSION_TTL_SECONDS + 1) * 1000;
    expect(await getSessionUser(reqWith(valueOf(setCookie)), deps({ now: () => later }))).toBeNull();
  });

  it("rejects when the user no longer exists", async () => {
    expect(await getSessionUser(reqWith(valueOf(setCookie)), deps({ userExists: async () => false }))).toBeNull();
  });

  it("connectStartPath keeps its contract", () => {
    expect(connectStartPath("/a?b=c")).toBe("/api/connect/google/start?return_to=%2Fa%3Fb%3Dc");
  });
});

describe("csrf token", () => {
  const cookie = valueOf(createSessionCookie({ userId: "u1", email: "a@x.com" }, deps()));
  it("verifies for the same session only", () => {
    const t = csrfTokenFor(cookie, SECRET)!;
    expect(verifyCsrf(cookie, t, SECRET)).toBe(true);
    expect(verifyCsrf(cookie, "nope", SECRET)).toBe(false);
    expect(verifyCsrf(cookie, null, SECRET)).toBe(false);
    expect(verifyCsrf(`${SESSION_COOKIE}=other.value`, t, SECRET)).toBe(false);
    expect(verifyCsrf(null, t, SECRET)).toBe(false);
  });
});
