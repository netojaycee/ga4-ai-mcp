import { handleAuthorizeGet, handleAuthorizePost } from "@/server/oauth/authorize";
import { handleToken } from "@/server/oauth/tokens";
import { BASE, CHALLENGE, MCP, REDIRECT, VERIFIER, authorizeUrl, formReq, type Harness } from "./fakes";

/** Drives GET consent -> POST approve and returns the issued auth code. */
export async function getCode(h: Harness, extra: Record<string, string | null> = {}): Promise<string> {
  const url = authorizeUrl(extra);
  const page = await handleAuthorizeGet(h.deps, new Request(url));
  const html = await page.text();
  const csrf = /name="csrf" value="([^"]+)"/.exec(html)![1];
  const u = new URL(url);
  const fields: Record<string, string> = { csrf, decision: "approve" };
  u.searchParams.forEach((v, k) => (fields[k] = v));
  const res = await handleAuthorizePost(
    h.deps,
    formReq(`${BASE}/oauth/authorize`, fields, { cookie: `oauth_csrf=${csrf}`, origin: BASE }),
  );
  const loc = new URL(res.headers.get("location")!);
  return loc.searchParams.get("code")!;
}

export function tokenReq(fields: Record<string, string>): Request {
  return formReq(`${BASE}/oauth/token`, fields);
}

export function codeGrant(code: string, over: Record<string, string> = {}): Record<string, string> {
  return {
    grant_type: "authorization_code",
    client_id: "client-1",
    code,
    code_verifier: VERIFIER,
    redirect_uri: REDIRECT,
    resource: MCP,
    ...over,
  };
}

export async function exchange(h: Harness, code: string, over: Record<string, string> = {}) {
  const res = await handleToken(h.deps, tokenReq(codeGrant(code, over)));
  return { status: res.status, body: (await res.json()) as Record<string, string>, headers: res.headers };
}

export async function refresh(h: Harness, token: string, over: Record<string, string> = {}) {
  const res = await handleToken(
    h.deps,
    tokenReq({ grant_type: "refresh_token", client_id: "client-1", refresh_token: token, ...over }),
  );
  return { status: res.status, body: (await res.json()) as Record<string, string> };
}

export { CHALLENGE };
