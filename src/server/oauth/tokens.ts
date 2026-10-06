import { pkceS256, safeEqual, sha256Hex } from "@/server/security/hash";
import { OAUTH, sameResource } from "./config";
import type { OAuthDeps } from "./deps";
import { CORS, NO_STORE, jsonResponse, oauthError, readCappedText } from "./http";
import type { TokenRecord, TokenRepo } from "./repo";

const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;
const MAX_CHAIN = 5000;

/** Revokes every descendant of `rootParentHash` (an auth code hash or a token hash). */
async function revokeDescendants(tokens: TokenRepo, rootParentHash: string, at: Date): Promise<void> {
  const seen = new Set<string>([rootParentHash]);
  let frontier = [rootParentHash];
  while (frontier.length > 0 && seen.size < MAX_CHAIN) {
    const kids = (await tokens.findChildren(frontier)).filter((k) => !seen.has(k.tokenHash));
    if (kids.length === 0) break;
    const hashes = kids.map((k) => k.tokenHash);
    await tokens.revokeMany(hashes, at);
    hashes.forEach((h) => seen.add(h));
    frontier = hashes;
  }
}

/** Revokes the whole rotation chain a token belongs to: walk up to the root, then revoke everything below it. */
export async function revokeChain(tokens: TokenRepo, start: TokenRecord, at: Date): Promise<void> {
  let root = start;
  for (let i = 0; i < MAX_CHAIN && root.parentHash; i++) {
    const parent = await tokens.find(root.parentHash);
    if (!parent) break;
    root = parent;
  }
  await tokens.revokeMany([start.tokenHash, root.tokenHash], at);
  await revokeDescendants(tokens, root.tokenHash, at);
  if (root.parentHash) await revokeDescendants(tokens, root.parentHash, at);
}

interface Issue {
  clientId: string;
  userId: string;
  resource: string;
  scope: string;
  /** Auth code hash, or the previous refresh token's hash. */
  parentHash: string;
}

async function issuePair(deps: OAuthDeps, i: Issue): Promise<Response> {
  const now = deps.now();
  const access = deps.random();
  const refresh = deps.random();
  const refreshHash = sha256Hex(refresh);
  const base = { clientId: i.clientId, userId: i.userId, resource: i.resource, scope: i.scope, revokedAt: null };
  await deps.tokens.insert({
    ...base,
    tokenHash: refreshHash,
    kind: "refresh",
    expiresAt: new Date(now.getTime() + OAUTH.refreshTtlSec * 1000),
    parentHash: i.parentHash,
  });
  await deps.tokens.insert({
    ...base,
    tokenHash: sha256Hex(access),
    kind: "access",
    expiresAt: new Date(now.getTime() + OAUTH.accessTtlSec * 1000),
    parentHash: refreshHash,
  });
  return jsonResponse(
    200,
    {
      access_token: access,
      token_type: "Bearer",
      expires_in: OAUTH.accessTtlSec,
      refresh_token: refresh,
      scope: i.scope,
    },
    { ...NO_STORE, ...CORS },
  );
}

const invalidGrant = (d: string) => oauthError(400, "invalid_grant", d);

async function authorizationCodeGrant(deps: OAuthDeps, p: URLSearchParams): Promise<Response> {
  const clientId = p.get("client_id");
  const code = p.get("code");
  const verifier = p.get("code_verifier");
  if (!clientId || !code) return oauthError(400, "invalid_request", "client_id and code are required.");
  if (!verifier || !VERIFIER_RE.test(verifier)) {
    return oauthError(400, "invalid_request", "A valid code_verifier is required.");
  }
  const client = await deps.clients.find(clientId);
  if (!client) return oauthError(401, "invalid_client", "Unknown client.");

  const codeHash = sha256Hex(code);
  const record = await deps.codes.find(codeHash);
  if (!record) return invalidGrant("Invalid authorization code.");
  const now = deps.now();
  const alreadyUsed = record.usedAt !== null;

  // Burn the code first: any failure below leaves it unusable, and a replay revokes what it issued.
  const won = await deps.codes.markUsed(codeHash, now);
  if (!won || alreadyUsed) {
    await revokeDescendants(deps.tokens, codeHash, now);
    return invalidGrant("Authorization code already used.");
  }
  if (record.clientId !== clientId) return invalidGrant("Code was not issued to this client.");
  if (record.expiresAt.getTime() <= now.getTime()) return invalidGrant("Authorization code expired.");
  const redirectUri = p.get("redirect_uri");
  if (redirectUri === null || !safeEqual(redirectUri, record.redirectUri)) {
    return invalidGrant("redirect_uri does not match the authorization request.");
  }
  if (!safeEqual(pkceS256(verifier), record.codeChallenge)) return invalidGrant("PKCE verification failed.");
  const resources = p.getAll("resource");
  if (resources.length > 1 || (resources.length === 1 && !sameResource(resources[0], record.resource))) {
    return oauthError(400, "invalid_target", "resource does not match the authorization request.");
  }
  return issuePair(deps, {
    clientId,
    userId: record.userId,
    resource: record.resource,
    scope: record.scope,
    parentHash: codeHash,
  });
}

async function refreshGrant(deps: OAuthDeps, p: URLSearchParams): Promise<Response> {
  const clientId = p.get("client_id");
  const token = p.get("refresh_token");
  if (!clientId || !token) return oauthError(400, "invalid_request", "client_id and refresh_token are required.");
  const client = await deps.clients.find(clientId);
  if (!client) return oauthError(401, "invalid_client", "Unknown client.");

  const hash = sha256Hex(token);
  const record = await deps.tokens.find(hash);
  if (!record || record.kind !== "refresh" || record.clientId !== clientId) {
    return invalidGrant("Invalid refresh token.");
  }
  const now = deps.now();
  if (record.revokedAt) {
    // Reuse of a rotated (or revoked) refresh token: assume theft, kill the whole chain.
    await revokeChain(deps.tokens, record, now);
    return invalidGrant("Refresh token has been revoked.");
  }
  if (record.expiresAt.getTime() <= now.getTime()) return invalidGrant("Refresh token expired.");
  const resources = p.getAll("resource");
  if (resources.length > 1 || (resources.length === 1 && !sameResource(resources[0], record.resource))) {
    return oauthError(400, "invalid_target", "resource does not match the original grant.");
  }
  let scope = record.scope;
  const requested = p.get("scope");
  if (requested) {
    const granted = new Set(record.scope.split(" "));
    const asked = requested.split(/\s+/).filter(Boolean);
    if (!asked.every((s) => granted.has(s))) return oauthError(400, "invalid_scope", "Scope exceeds the original grant.");
    scope = asked.join(" ");
  }
  const rotated = await deps.tokens.revokeIfActive(hash, now);
  if (!rotated) {
    // Lost a race with another use of the same token: same treatment as reuse.
    await revokeChain(deps.tokens, record, now);
    return invalidGrant("Refresh token has been revoked.");
  }
  return issuePair(deps, { clientId, userId: record.userId, resource: record.resource, scope, parentHash: hash });
}

export async function handleToken(deps: OAuthDeps, req: Request): Promise<Response> {
  if (!(req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    return oauthError(400, "invalid_request", "Content-Type must be application/x-www-form-urlencoded.");
  }
  const text = await readCappedText(req, OAUTH.maxBodyBytes);
  if (text === null) return oauthError(400, "invalid_request", "Request too large.");
  const p = new URLSearchParams(text);
  for (const name of ["grant_type", "client_id", "code", "refresh_token", "code_verifier", "redirect_uri"]) {
    if (p.getAll(name).length > 1) return oauthError(400, "invalid_request", `Duplicate parameter: ${name}.`);
  }
  switch (p.get("grant_type")) {
    case "authorization_code":
      return authorizationCodeGrant(deps, p);
    case "refresh_token":
      return refreshGrant(deps, p);
    default:
      return oauthError(400, "unsupported_grant_type", "Supported: authorization_code, refresh_token.");
  }
}

/** RFC 7009. Always 200 for well-formed requests, whether or not the token existed. */
export async function handleRevoke(deps: OAuthDeps, req: Request): Promise<Response> {
  if (!(req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded")) {
    return oauthError(400, "invalid_request", "Content-Type must be application/x-www-form-urlencoded.");
  }
  const text = await readCappedText(req, OAUTH.maxBodyBytes);
  if (text === null) return oauthError(400, "invalid_request", "Request too large.");
  const p = new URLSearchParams(text);
  const token = p.get("token");
  if (!token) return oauthError(400, "invalid_request", "token is required.");
  const clientId = p.get("client_id");
  const record = await deps.tokens.find(sha256Hex(token));
  if (record && (clientId === null || record.clientId === clientId)) {
    const now = deps.now();
    if (record.kind === "refresh") await revokeChain(deps.tokens, record, now);
    else await deps.tokens.revokeIfActive(record.tokenHash, now);
  }
  return new Response(null, { status: 200, headers: { ...NO_STORE, ...CORS } });
}
