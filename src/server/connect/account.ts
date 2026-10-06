import { clearSessionCookie, getSessionUserFromCookieHeader, verifyCsrf, type SessionDeps } from "@/server/auth/session";
import { sha256Hex } from "@/server/security/hash";
import { htmlPage, redirect } from "./html";
import type { GoogleClient } from "./google";
import type { ConnectRepository } from "./repository";

export interface AccountDeps {
  google: GoogleClient;
  repo: ConnectRepository;
  baseUrl: string;
  sessionSecret: string;
  /** Decrypts the stored refresh token (so it can be revoked at Google). */
  decrypt: (payload: string) => string;
  now: () => number;
  session?: Partial<SessionDeps>;
}

/** Revokes at Google (best effort), deletes the encrypted token and revokes our own tokens. */
export async function disconnectUser(
  d: Pick<AccountDeps, "google" | "repo" | "decrypt" | "now">,
  userId: string,
  action: "account.disconnect" | "account.delete" | "admin.user.google_disconnected",
  actor = `user:${userId}`,
) {
  let googleRevoked = false;
  try {
    const enc = await d.repo.getConnectionTokenEnc(userId);
    if (enc) googleRevoked = await d.google.revoke(d.decrypt(enc));
  } catch {
    googleRevoked = false;
  }
  await d.repo.deleteConnection(userId);
  const revokedTokens = await d.repo.revokeOAuthTokens(userId, new Date(d.now()));
  await d.repo.audit({ actor, action, target: userId, meta: { googleRevoked, revokedTokens } });
  return { googleRevoked, revokedTokens };
}

/** Everything in disconnectUser, then deletes the user row (cascades) and clears the session. */
export async function deleteUserData(d: Pick<AccountDeps, "google" | "repo" | "decrypt" | "now">, userId: string) {
  // Remember plan state first, so deleting and signing in again cannot reset a trial or lift a suspension.
  const facts = await d.repo.getDeletionFacts(userId);
  if (facts) {
    await d.repo.recordTombstone({
      subHash: sha256Hex(facts.googleSub),
      plan: facts.plan,
      trialEndsAt: facts.trialEndsAt,
      now: new Date(d.now()),
    });
  }
  await disconnectUser(d, userId, "account.delete");
  await d.repo.deleteUser(userId);
}

function originOk(req: Request, baseUrl: string): boolean {
  const origin = req.headers.get("origin");
  return origin === null || origin === new URL(baseUrl).origin;
}

/** POST handler body shared by disconnect and delete. */
export async function handleAccountAction(req: Request, d: AccountDeps, kind: "disconnect" | "delete"): Promise<Response> {
  const cookie = req.headers.get("cookie");
  const user = await getSessionUserFromCookieHeader(cookie, {
    secret: () => d.sessionSecret,
    now: d.now,
    userExists: async (id) => (await d.repo.getAccount(id)) !== null,
    ...d.session,
  });
  if (!user) return redirect(`${d.baseUrl}/account`, [], 303);

  let token: string | null = null;
  try {
    token = String((await req.formData()).get("csrf") ?? "") || null;
  } catch {
    token = null;
  }
  if (!originOk(req, d.baseUrl) || !verifyCsrf(cookie, token, d.sessionSecret)) {
    return htmlPage({
      title: "Request could not be verified",
      status: 403,
      bodyHtml: '<p>The security check for this request failed. Go back to your <a href="/account">account page</a>, reload it and try again.</p>',
    });
  }

  if (kind === "delete") {
    await deleteUserData(d, user.userId);
    return redirect(`${d.baseUrl}/account?msg=deleted`, [clearSessionCookie()], 303);
  }
  await disconnectUser(d, user.userId, "account.disconnect");
  return redirect(`${d.baseUrl}/account?msg=disconnected`, [], 303);
}

/** POST /api/connect/logout: ends this browser's session (CSRF + Origin checked). Does not touch Google or AI client tokens. */
export async function handleLogout(req: Request, d: Pick<AccountDeps, "baseUrl" | "sessionSecret">): Promise<Response> {
  const cookie = req.headers.get("cookie");
  let token: string | null = null;
  try {
    token = String((await req.formData()).get("csrf") ?? "") || null;
  } catch {
    token = null;
  }
  if (!originOk(req, d.baseUrl) || !verifyCsrf(cookie, token, d.sessionSecret)) {
    return htmlPage({
      title: "Request could not be verified",
      status: 403,
      bodyHtml: '<p>The security check for this request failed. Go back to your <a href="/account">account page</a>, reload it and try again.</p>',
    });
  }
  return redirect(`${d.baseUrl}/account?msg=signedout`, [clearSessionCookie()], 303);
}
