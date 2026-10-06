import { beforeEach, describe, expect, it } from "vitest";
import { handleAuthorizeGet, handleAuthorizePost } from "@/server/oauth/authorize";
import { BASE, MCP, REDIRECT, addClient, authorizeUrl, formReq, makeHarness, hashOf, type Harness } from "./fakes";
import { getCode } from "./flow";

let h: Harness;
beforeEach(() => {
  h = makeHarness();
  addClient(h);
});

const get = (url: string) => handleAuthorizeGet(h.deps, new Request(url));

describe("authorize: errors before redirect URI is trusted render a page", () => {
  it.each([
    ["unknown client", { client_id: "nope" }],
    ["redirect_uri mismatch", { redirect_uri: "https://evil.example/cb" }],
    ["redirect_uri prefix trick", { redirect_uri: `${REDIRECT}/../x` }],
    ["redirect_uri with extra query", { redirect_uri: `${REDIRECT}?a=1` }],
    ["missing client_id", { client_id: null }],
  ])("%s", async (_n, extra) => {
    const res = await get(authorizeUrl(extra));
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
    expect(res.headers.get("content-type")).toContain("text/html");
  });

  it("duplicate redirect_uri is refused without redirecting", async () => {
    const res = await get(authorizeUrl() + "&redirect_uri=https://evil.example/cb");
    expect(res.status).toBe(400);
    expect(res.headers.get("location")).toBeNull();
  });
});

describe("authorize: errors after trust redirect to the registered URI", () => {
  const cases: [string, Record<string, string | null>, string][] = [
    ["missing PKCE", { code_challenge: null }, "invalid_request"],
    ["plain method", { code_challenge_method: "plain" }, "invalid_request"],
    ["missing method", { code_challenge_method: null }, "invalid_request"],
    ["short challenge", { code_challenge: "abc" }, "invalid_request"],
    ["token response_type", { response_type: "token" }, "unsupported_response_type"],
    ["wrong resource", { resource: "https://other.example/mcp" }, "invalid_target"],
  ];
  it.each(cases)("%s", async (_n, extra, error) => {
    const res = await get(authorizeUrl(extra));
    expect(res.status).toBe(303);
    const loc = new URL(res.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("error")).toBe(error);
    expect(loc.searchParams.get("state")).toBe("st123");
    expect(loc.searchParams.get("code")).toBeNull();
  });
});

describe("authorize: login and consent", () => {
  it("sends logged-out users to the connect flow with the full authorize URL", async () => {
    h.session.user = null;
    const url = authorizeUrl();
    const res = await get(url);
    expect(res.status).toBe(302);
    const loc = res.headers.get("location")!;
    expect(loc.startsWith("/api/connect/google/start?return_to=")).toBe(true);
    expect(decodeURIComponent(loc.split("return_to=")[1])).toBe(`/oauth/authorize${new URL(url).search}`);
  });

  it("defaults resource to the /mcp URL when omitted", async () => {
    const res = await get(authorizeUrl({ resource: null }));
    expect(res.status).toBe(200);
  });

  it("consent page has strict headers, csrf cookie, and escapes hostile client names", async () => {
    addClient(h, { clientId: "client-1", clientName: `<script>alert(1)</script>"'` });
    const res = await get(authorizeUrl({ state: `"><img src=x onerror=alert(1)>` }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-frame-options")).toBe("DENY");
    expect(res.headers.get("content-security-policy")).toContain("frame-ancestors 'none'");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("set-cookie")).toMatch(/oauth_csrf=.+HttpOnly.+SameSite=Strict/);
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("wants to read your Google Analytics and Search Console data via TestBrand");
  });
});

describe("authorize: consent POST", () => {
  async function consent() {
    const page = await get(authorizeUrl());
    const html = await page.text();
    const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
    const fields: Record<string, string> = { csrf, decision: "approve" };
    new URL(authorizeUrl()).searchParams.forEach((v, k) => (fields[k] = v));
    return { csrf, fields };
  }
  const post = (fields: Record<string, string>, headers: Record<string, string>) =>
    handleAuthorizePost(h.deps, formReq(`${BASE}/oauth/authorize`, fields, headers));

  it("rejects missing, mismatched or absent csrf", async () => {
    const { csrf, fields } = await consent();
    for (const r of [
      await post(fields, { origin: BASE }),
      await post(fields, { origin: BASE, cookie: "oauth_csrf=other" }),
      await post({ ...fields, csrf: "" }, { origin: BASE, cookie: `oauth_csrf=${csrf}` }),
    ]) {
      expect(r.status).toBe(403);
      expect(r.headers.get("location")).toBeNull();
    }
    expect(h.codes.size).toBe(0);
  });

  it("rejects cross-origin posts even with a valid token", async () => {
    const { csrf, fields } = await consent();
    const r = await post(fields, { origin: "https://evil.example", cookie: `oauth_csrf=${csrf}` });
    expect(r.status).toBe(403);
    expect(h.codes.size).toBe(0);
  });

  it("accepts `Origin: null` only when the browser also reports same-origin (no-referrer style form POSTs)", async () => {
    const { csrf, fields } = await consent();
    const cookie = `oauth_csrf=${csrf}`;
    expect((await post(fields, { origin: "null", "sec-fetch-site": "same-origin", cookie })).status).toBe(303);
    const extras: Record<string, string>[] = [{ "sec-fetch-site": "cross-site" }, { "sec-fetch-site": "same-site" }, {}];
    for (const extra of extras) {
      const c = await consent();
      const r = await post(c.fields, { origin: "null", cookie: `oauth_csrf=${c.csrf}`, ...extra });
      expect(r.status).toBe(403);
    }
  });

  it("the consent page does not use Referrer-Policy: no-referrer (it would make the POST carry Origin: null)", async () => {
    const page = await get(authorizeUrl());
    expect(page.headers.get("referrer-policy")).toBe("same-origin");
  });

  it("approve issues a hashed, 5 minute, bound code and redirects with state", async () => {
    const { csrf, fields } = await consent();
    const r = await post(fields, { origin: BASE, cookie: `oauth_csrf=${csrf}` });
    expect(r.status).toBe(303);
    const loc = new URL(r.headers.get("location")!);
    expect(loc.origin + loc.pathname).toBe(REDIRECT);
    expect(loc.searchParams.get("state")).toBe("st123");
    expect(loc.searchParams.get("iss")).toBe(BASE);
    const code = loc.searchParams.get("code")!;
    const rec = h.codes.get(hashOf(code))!;
    expect(rec).toBeDefined();
    expect(h.codes.has(code)).toBe(false);
    expect(rec.expiresAt.getTime() - h.clock.now.getTime()).toBe(5 * 60 * 1000);
    expect(rec).toMatchObject({ clientId: "client-1", redirectUri: REDIRECT, resource: MCP, usedAt: null });
  });

  it("deny redirects with access_denied and issues nothing", async () => {
    const { csrf, fields } = await consent();
    const r = await post({ ...fields, decision: "deny" }, { origin: BASE, cookie: `oauth_csrf=${csrf}` });
    const loc = new URL(r.headers.get("location")!);
    expect(loc.searchParams.get("error")).toBe("access_denied");
    expect(loc.searchParams.get("state")).toBe("st123");
    expect(h.codes.size).toBe(0);
  });

  it("tampered hidden fields cannot redirect to an unregistered URI (open redirect)", async () => {
    const { csrf, fields } = await consent();
    const r = await post({ ...fields, redirect_uri: "https://evil.example/steal" }, { origin: BASE, cookie: `oauth_csrf=${csrf}` });
    expect(r.status).toBe(400);
    expect(r.headers.get("location")).toBeNull();
    expect(h.codes.size).toBe(0);
  });

  it("without a session the POST goes to login, not to a code", async () => {
    const { csrf, fields } = await consent();
    h.session.user = null;
    const r = await post(fields, { origin: BASE, cookie: `oauth_csrf=${csrf}` });
    expect(r.headers.get("location")).toContain("/api/connect/google/start");
    expect(h.codes.size).toBe(0);
  });

  it("flow helper obtains a code", async () => {
    expect(await getCode(h)).toBeTruthy();
  });
});
