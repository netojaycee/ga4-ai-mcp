import { connectStartPath } from "@/server/auth/session";
import { safeEqual, sha256Hex } from "@/server/security/hash";
import { OAUTH, PATHS, canonicalResource, grantScope, sameResource } from "./config";
import type { OAuthDeps } from "./deps";
import { consentPage, errorPage } from "./html";
import type { OAuthClient } from "./repo";

const CSRF_COOKIE = "oauth_csrf";
const CHALLENGE_RE = /^[A-Za-z0-9_-]{43}$/;

type Validation =
  | { kind: "page_error"; message: string }
  | { kind: "redirect_error"; redirectUri: string; error: string; description: string; state: string | null }
  | {
      kind: "ok";
      client: OAuthClient;
      redirectUri: string;
      state: string | null;
      codeChallenge: string;
      resource: string;
      scope: string;
    };

/**
 * Order matters: until client_id and redirect_uri are verified against registration, nothing may redirect.
 */
export async function validateAuthorizeParams(deps: OAuthDeps, params: URLSearchParams): Promise<Validation> {
  const one = (name: string): string | null | "dup" => {
    const all = params.getAll(name);
    if (all.length > 1) return "dup";
    return all[0] ?? null;
  };
  const clientId = one("client_id");
  if (!clientId || clientId === "dup" || clientId.length > 200) {
    return { kind: "page_error", message: "Missing or invalid client_id." };
  }
  const client = await deps.clients.find(clientId);
  if (!client) return { kind: "page_error", message: "Unknown client." };

  const redirectParam = one("redirect_uri");
  if (redirectParam === "dup") return { kind: "page_error", message: "Invalid redirect_uri." };
  let redirectUri: string;
  if (redirectParam === null) {
    if (client.redirectUris.length !== 1) return { kind: "page_error", message: "Missing redirect_uri." };
    redirectUri = client.redirectUris[0];
  } else {
    if (!client.redirectUris.includes(redirectParam)) {
      return { kind: "page_error", message: "The redirect_uri does not match this client's registration." };
    }
    redirectUri = redirectParam;
  }

  // From here on the redirect target is trusted.
  const rawState = one("state");
  const state = rawState === "dup" ? null : rawState;
  const fail = (error: string, description: string): Validation => ({
    kind: "redirect_error",
    redirectUri,
    error,
    description,
    state: state && state.length <= OAUTH.maxStateLength ? state : null,
  });

  if (rawState === "dup" || (state !== null && state.length > OAUTH.maxStateLength)) {
    return fail("invalid_request", "Invalid state.");
  }
  if (one("response_type") !== "code") return fail("unsupported_response_type", "Only response_type=code is supported.");

  const challenge = one("code_challenge");
  if (!challenge || challenge === "dup" || !CHALLENGE_RE.test(challenge)) {
    return fail("invalid_request", "A valid PKCE code_challenge is required.");
  }
  const method = one("code_challenge_method");
  if (method !== "S256") return fail("invalid_request", "code_challenge_method must be S256.");

  const resources = params.getAll("resource");
  if (resources.length > 1) return fail("invalid_target", "Only one resource may be specified.");
  const resource = resources[0] ?? deps.mcpUrl;
  if (!sameResource(resource, deps.mcpUrl)) return fail("invalid_target", "Unknown resource.");

  const scope = one("scope");
  return {
    kind: "ok",
    client,
    redirectUri,
    state,
    codeChallenge: challenge,
    resource: canonicalResource(deps.mcpUrl) ?? deps.mcpUrl,
    scope: grantScope(scope === "dup" ? null : scope),
  };
}

function redirectTo(deps: OAuthDeps, base: string, values: Record<string, string | null>, headers: HeadersInit = {}) {
  const u = new URL(base);
  for (const [k, v] of Object.entries(values)) if (v !== null) u.searchParams.set(k, v);
  u.searchParams.set("iss", deps.baseUrl);
  const h = new Headers(headers);
  h.set("Location", u.toString());
  h.set("Cache-Control", "no-store");
  return new Response(null, { status: 303, headers: h });
}

function cookieValue(req: Request, name: string): string | null {
  for (const part of (req.headers.get("cookie") ?? "").split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) return rest.join("=");
  }
  return null;
}

function csrfCookie(deps: OAuthDeps, value: string, maxAge: number): string {
  const secure = deps.baseUrl.startsWith("https:") ? "; Secure" : "";
  return `${CSRF_COOKIE}=${value}; Path=${PATHS.authorize}; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure}`;
}

const FORM_FIELDS = ["client_id", "redirect_uri", "response_type", "code_challenge", "code_challenge_method", "state", "resource", "scope"];

function loginRedirect(params: URLSearchParams): Response {
  const q = new URLSearchParams();
  for (const name of FORM_FIELDS) for (const v of params.getAll(name)) q.append(name, v);
  return new Response(null, {
    status: 303,
    headers: { Location: connectStartPath(`${PATHS.authorize}?${q.toString()}`), "Cache-Control": "no-store" },
  });
}

export async function handleAuthorizeGet(deps: OAuthDeps, req: Request): Promise<Response> {
  const url = new URL(req.url);
  const v = await validateAuthorizeParams(deps, url.searchParams);
  if (v.kind === "page_error") return errorPage(v.message);
  if (v.kind === "redirect_error") {
    return redirectTo(deps, v.redirectUri, { error: v.error, error_description: v.description, state: v.state });
  }
  const user = await deps.getUser(req);
  if (!user) {
    return new Response(null, {
      status: 302,
      headers: { Location: connectStartPath(`${PATHS.authorize}${url.search}`), "Cache-Control": "no-store" },
    });
  }
  const csrf = deps.random();
  const fields: Record<string, string> = {};
  for (const name of FORM_FIELDS) {
    const value = url.searchParams.get(name);
    if (value !== null) fields[name] = value;
  }
  return consentPage(
    {
      brandName: deps.brandName,
      clientName: v.client.clientName ?? "An application",
      redirectHost: new URL(v.redirectUri).host,
      email: user.email,
      fields,
      csrf,
    },
    { "Set-Cookie": csrfCookie(deps, csrf, 900) },
  );
}

/**
 * CSRF layer 1 (the double-submit cookie is layer 2). A browser sends our exact origin on a same-origin form POST.
 * Some privacy settings and referrer policies turn that into the literal "null"; accept that only when the browser
 * also says the request is same-origin. A foreign or sandboxed origin is always rejected.
 */
export function isSameOriginPost(req: Request, baseUrl: string): boolean {
  const origin = req.headers.get("origin");
  if (origin === null) return true;
  if (origin === new URL(baseUrl).origin) return true;
  return origin === "null" && req.headers.get("sec-fetch-site") === "same-origin";
}

export async function handleAuthorizePost(deps: OAuthDeps, req: Request): Promise<Response> {
  if (!isSameOriginPost(req, deps.baseUrl)) {
    return errorPage("Cross-origin request rejected.", 403);
  }
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.includes("application/x-www-form-urlencoded")) return errorPage("Unsupported request.", 415);
  const text = await req.text();
  if (text.length > OAUTH.maxBodyBytes) return errorPage("Request too large.", 413);
  const form = new URLSearchParams(text);

  const submitted = form.get("csrf");
  const cookie = cookieValue(req, CSRF_COOKIE);
  if (!submitted || !cookie || !safeEqual(submitted, cookie)) {
    return errorPage("This page expired or the request could not be verified. Please start again from your app.", 403);
  }

  const v = await validateAuthorizeParams(deps, form);
  if (v.kind === "page_error") return errorPage(v.message);
  if (v.kind === "redirect_error") {
    return redirectTo(deps, v.redirectUri, { error: v.error, error_description: v.description, state: v.state });
  }
  const clearCookie = { "Set-Cookie": csrfCookie(deps, "", 0) };

  const user = await deps.getUser(req);
  if (!user) return loginRedirect(form);

  if (form.get("decision") !== "approve") {
    return redirectTo(
      deps,
      v.redirectUri,
      { error: "access_denied", error_description: "The user denied the request.", state: v.state },
      clearCookie,
    );
  }

  const code = deps.random();
  await deps.codes.insert({
    codeHash: sha256Hex(code),
    clientId: v.client.clientId,
    userId: user.userId,
    redirectUri: v.redirectUri,
    codeChallenge: v.codeChallenge,
    resource: v.resource,
    scope: v.scope,
    expiresAt: new Date(deps.now().getTime() + OAUTH.codeTtlMs),
    usedAt: null,
  });
  return redirectTo(deps, v.redirectUri, { code, state: v.state }, clearCookie);
}
