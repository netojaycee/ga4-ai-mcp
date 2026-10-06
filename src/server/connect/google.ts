import { z } from "zod";

export const GOOGLE_SCOPE_ANALYTICS = "https://www.googleapis.com/auth/analytics.readonly";
export const GOOGLE_SCOPE_SEARCH_CONSOLE = "https://www.googleapis.com/auth/webmasters.readonly";
export const REQUIRED_SCOPES = [GOOGLE_SCOPE_ANALYTICS, GOOGLE_SCOPE_SEARCH_CONSOLE] as const;
export const REQUESTED_SCOPES = ["openid", "email", "profile", ...REQUIRED_SCOPES] as const;

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const REVOKE_URL = "https://oauth2.googleapis.com/revoke";

export interface GoogleTokens {
  refreshToken?: string;
  idToken: string;
  /** Space-separated scopes actually granted. */
  scope: string;
}

export interface GoogleIdentity {
  sub: string;
  email: string;
  name: string | null;
}

/** Everything the flow needs from Google. Fakeable in tests. */
export interface GoogleClient {
  authUrl(p: { redirectUri: string; state: string; codeChallenge: string }): string;
  exchangeCode(p: { code: string; redirectUri: string; codeVerifier: string }): Promise<GoogleTokens>;
  /** Verifies the ID token (audience, issuer, expiry) and returns the identity. Throws if invalid. */
  verifyIdToken(idToken: string): GoogleIdentity;
  /** Best effort; never throws. */
  revoke(token: string): Promise<boolean>;
}

const tokenResponse = z.object({
  id_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  scope: z.string().default(""),
});

const idClaims = z.object({
  iss: z.string(),
  aud: z.union([z.string(), z.array(z.string())]),
  exp: z.number(),
  sub: z.string().min(1),
  email: z.string().min(3),
  /** Google sends a boolean; some token paths have been seen to send the string "true". */
  email_verified: z.union([z.boolean(), z.enum(["true", "false"])]).optional(),
  name: z.string().optional(),
});

/** The Google account's email is not verified, so it must not drive plan grants or admin access. */
export class EmailNotVerifiedError extends Error {
  constructor() {
    super("Google account email is not verified");
    this.name = "EmailNotVerifiedError";
  }
}

/**
 * Validates ID token claims. The token comes straight from Google's token endpoint over TLS in exchange
 * for our authorization code, so per Google's OpenID Connect docs signature verification may be skipped;
 * we still enforce issuer, audience and expiry.
 */
export function parseIdToken(idToken: string, clientId: string, nowSeconds: number): GoogleIdentity {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new Error("Malformed ID token");
  let raw: unknown;
  try {
    raw = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8"));
  } catch {
    throw new Error("Malformed ID token");
  }
  const c = idClaims.safeParse(raw);
  if (!c.success) throw new Error("ID token is missing required claims");
  const { iss, aud, exp, sub, email, name, email_verified } = c.data;
  if (iss !== "https://accounts.google.com" && iss !== "accounts.google.com") throw new Error("ID token issuer mismatch");
  if (!(Array.isArray(aud) ? aud.includes(clientId) : aud === clientId)) throw new Error("ID token audience mismatch");
  if (exp <= nowSeconds) throw new Error("ID token expired");
  if (email_verified !== true && email_verified !== "true") throw new EmailNotVerifiedError();
  return { sub, email, name: name ?? null };
}

export function createGoogleClient(cfg: { clientId: string; clientSecret: string; now?: () => number }): GoogleClient {
  const now = cfg.now ?? (() => Date.now());
  return {
    authUrl({ redirectUri, state, codeChallenge }) {
      const u = new URL(AUTH_URL);
      u.search = new URLSearchParams({
        client_id: cfg.clientId,
        redirect_uri: redirectUri,
        response_type: "code",
        scope: REQUESTED_SCOPES.join(" "),
        state,
        code_challenge: codeChallenge,
        code_challenge_method: "S256",
        access_type: "offline",
        prompt: "consent",
        include_granted_scopes: "true",
      }).toString();
      return u.toString();
    },
    async exchangeCode({ code, redirectUri, codeVerifier }) {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          code,
          client_id: cfg.clientId,
          client_secret: cfg.clientSecret,
          redirect_uri: redirectUri,
          grant_type: "authorization_code",
          code_verifier: codeVerifier,
        }),
      });
      // Never include the response body in errors: it can carry tokens.
      if (!res.ok) throw new Error(`Google token exchange failed (HTTP ${res.status})`);
      const parsed = tokenResponse.safeParse(await res.json());
      if (!parsed.success) throw new Error("Google token response was not in the expected shape");
      return { idToken: parsed.data.id_token, refreshToken: parsed.data.refresh_token, scope: parsed.data.scope };
    },
    verifyIdToken: (idToken) => parseIdToken(idToken, cfg.clientId, Math.floor(now() / 1000)),
    async revoke(token) {
      try {
        const res = await fetch(REVOKE_URL, {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ token }),
        });
        return res.ok;
      } catch {
        return false;
      }
    },
  };
}

export function missingScopes(granted: string): string[] {
  const set = new Set(granted.split(/\s+/).filter(Boolean));
  return REQUIRED_SCOPES.filter((s) => !set.has(s));
}
