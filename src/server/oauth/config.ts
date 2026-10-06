export const OAUTH = {
  codeTtlMs: 5 * 60 * 1000,
  accessTtlSec: 60 * 60,
  refreshTtlSec: 30 * 24 * 60 * 60,
  scopes: ["analytics:read"] as readonly string[],
  maxRedirectUris: 10,
  maxUriLength: 2048,
  maxClientNameLength: 100,
  maxBodyBytes: 16 * 1024,
  maxStateLength: 2048,
} as const;

export const PATHS = {
  register: "/oauth/register",
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  revoke: "/oauth/revoke",
} as const;

/** Canonical form of a resource URI: lowercase origin, no trailing slash, no query/fragment/userinfo. */
export function canonicalResource(raw: string): string | null {
  if (raw.includes("#")) return null;
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return null;
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return null;
  if (u.search || u.username || u.password) return null;
  return `${u.origin}${u.pathname.replace(/\/+$/, "")}`;
}

export function sameResource(a: string, b: string): boolean {
  const ca = canonicalResource(a);
  const cb = canonicalResource(b);
  return ca !== null && cb !== null && ca === cb;
}

/** Keeps only supported scopes; an empty or fully unknown request means all supported scopes. */
export function grantScope(requested: string | null | undefined): string {
  const asked = (requested ?? "").split(/\s+/).filter(Boolean);
  const granted = asked.filter((s) => OAUTH.scopes.includes(s));
  return (granted.length > 0 ? granted : [...OAUTH.scopes]).join(" ");
}
