import { z } from "zod";
import { CORS, NO_STORE, jsonResponse, oauthError, readCappedText } from "./http";
import { OAUTH } from "./config";
import type { OAuthDeps } from "./deps";

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Native-app redirects that use a private-use scheme (RFC 8252 7.1). Exact string match only, never a scheme-wide
 * allowance: any app on the user's machine can claim a scheme, so each entry is a deliberate, reviewed exception.
 * PKCE (mandatory here) is what keeps an intercepted code useless.
 */
export const ALLOWED_NATIVE_REDIRECTS: ReadonlySet<string> = new Set(["cursor://anysphere.cursor-mcp/oauth/callback"]);

/** https, or http on loopback, or an exact allowlisted native redirect. No fragments, wildcards, or userinfo. */
export function isValidRedirectUri(raw: string): boolean {
  if (ALLOWED_NATIVE_REDIRECTS.has(raw)) return true;
  if (raw.length > OAUTH.maxUriLength || raw.includes("#") || raw.includes("*")) return false;
  if (/[\u0000-\u001f\u007f\s\\]/.test(raw)) return false;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.username || u.password) return false;
  if (u.protocol === "https:") return u.hostname.length > 0;
  if (u.protocol === "http:") return LOOPBACK_HOSTS.has(u.hostname);
  return false;
}

const bodySchema = z.object({
  redirect_uris: z.array(z.string()).min(1).max(OAUTH.maxRedirectUris),
  client_name: z.string().max(OAUTH.maxClientNameLength).optional(),
  token_endpoint_auth_method: z.enum(["none", "client_secret_basic", "client_secret_post"]).optional(),
  grant_types: z.array(z.enum(["authorization_code", "refresh_token"])).max(2).optional(),
  response_types: z.array(z.literal("code")).max(1).optional(),
  scope: z.string().max(500).optional(),
});

function randomClientId(deps: OAuthDeps): string {
  return `c_${deps.random()}`;
}

export async function handleRegister(deps: OAuthDeps, req: Request): Promise<Response> {
  const limit = await deps.limitRegistration?.(req);
  if (limit && !limit.allowed) {
    const res = oauthError(429, "temporarily_unavailable", "Too many registrations. Try again later.");
    res.headers.set("Retry-After", String(limit.retryAfterSeconds));
    return res;
  }
  const text = await readCappedText(req, OAUTH.maxBodyBytes);
  if (text === null) return oauthError(413, "invalid_client_metadata", "Request body too large.");
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return oauthError(400, "invalid_client_metadata", "Body must be JSON.");
  }
  const parsed = bodySchema.safeParse(json);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const field = first?.path.join(".") || "body";
    const code = field.startsWith("redirect_uris") ? "invalid_redirect_uri" : "invalid_client_metadata";
    return oauthError(400, code, `Invalid ${field}.`);
  }
  const body = parsed.data;
  for (const uri of body.redirect_uris) {
    if (!isValidRedirectUri(uri)) {
      return oauthError(
        400,
        "invalid_redirect_uri",
        "Redirect URIs must be https (or http on localhost/127.0.0.1/[::1]) with no fragment or wildcard.",
      );
    }
  }
  const redirectUris = [...new Set(body.redirect_uris)];
  // Public clients only: a requested secret-based method is overridden with "none" (RFC 7591 3.2.1) and echoed back.
  const clientName = body.client_name?.replace(/[\u0000-\u001f\u007f]/g, " ").trim() || null;
  const client = {
    clientId: randomClientId(deps),
    clientName,
    redirectUris,
    tokenEndpointAuthMethod: "none",
  };
  await deps.clients.create(client);
  return jsonResponse(
    201,
    {
      client_id: client.clientId,
      client_id_issued_at: Math.floor(deps.now().getTime() / 1000),
      client_name: client.clientName ?? undefined,
      redirect_uris: redirectUris,
      grant_types: body.grant_types ?? ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
      scope: OAUTH.scopes.join(" "),
    },
    { ...NO_STORE, ...CORS },
  );
}
