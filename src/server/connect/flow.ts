import { DEFAULT_PLAN_FOR_NEW_USERS, type Plan } from "@/config/plans";
import { createSessionCookie } from "@/server/auth/session";
import { pkceS256, randomToken, safeEqual, sha256Hex } from "@/server/security/hash";
import { escapeHtml, htmlPage, redirect } from "./html";
import { EmailNotVerifiedError, missingScopes, type GoogleClient, REQUIRED_SCOPES } from "./google";
import type { ConnectRepository } from "./repository";
import { sanitizeReturnTo } from "./returnTo";
import { readCookie, serializeCookie, signPayload, verifyPayload } from "./signed";

export const STATE_COOKIE = "ga_oauth_state";
export const CALLBACK_PATH = "/api/connect/google/callback";
const STATE_COOKIE_PATH = "/api/connect/google";
const STATE_TTL_SECONDS = 10 * 60;

export interface ConnectDeps {
  google: GoogleClient;
  repo: ConnectRepository;
  baseUrl: string;
  sessionSecret: string;
  trialDays: number;
  defaultPlan?: Plan;
  /** Returns the encrypted payload and its key version. */
  encrypt: (plaintext: string) => { payload: string; keyVersion: number };
  now: () => number;
  secure: boolean;
}

interface StatePayload {
  /** Domain separation from the session cookie, which shares the signing secret. */
  typ: "oauth_state";
  state: string;
  verifier: string;
  returnTo: string;
  exp: number;
}

const stateCookie = (value: string, maxAge: number, d: ConnectDeps) =>
  serializeCookie(STATE_COOKIE, value, { maxAgeSeconds: maxAge, path: STATE_COOKIE_PATH, secure: d.secure });

const retryLink = (returnTo: string) =>
  `<p><a class="btn" href="/api/connect/google/start?return_to=${encodeURIComponent(returnTo)}">Try connecting again</a></p>`;

export function handleStart(req: Request, d: ConnectDeps): Response {
  const returnTo = sanitizeReturnTo(new URL(req.url).searchParams.get("return_to"));
  const state = randomToken(24);
  const verifier = randomToken(48);
  const exp = Math.floor(d.now() / 1000) + STATE_TTL_SECONDS;
  const cookie = stateCookie(signPayload({ typ: "oauth_state", state, verifier, returnTo, exp } satisfies StatePayload, d.sessionSecret), STATE_TTL_SECONDS, d);
  const url = d.google.authUrl({
    redirectUri: `${d.baseUrl}${CALLBACK_PATH}`,
    state,
    codeChallenge: pkceS256(verifier),
  });
  return redirect(url, [cookie]);
}

export async function handleCallback(req: Request, d: ConnectDeps): Promise<Response> {
  const params = new URL(req.url).searchParams;
  const clearState = stateCookie("", 0, d);
  const fail = (title: string, body: string, status = 400, returnTo = "/account") =>
    htmlPage({ title, status, bodyHtml: body + retryLink(returnTo), setCookies: [clearState] });

  const verified = verifyPayload<StatePayload>(
    readCookie(req.headers.get("cookie"), STATE_COOKIE),
    d.sessionSecret,
    Math.floor(d.now() / 1000),
  );
  const saved = verified?.typ === "oauth_state" ? verified : null;
  const returnTo = saved ? sanitizeReturnTo(saved.returnTo) : "/account";

  if (params.get("error") === "access_denied") {
    return fail(
      "Google access was not granted",
      "<p>You chose not to share access, so nothing was connected. We only ever request read-only access to Google Analytics and Search Console, and you can disconnect at any time.</p>",
      200,
      returnTo,
    );
  }

  const stateParam = params.get("state");
  if (!saved || !stateParam || !safeEqual(stateParam, saved.state)) {
    return fail(
      "Sign-in link expired or invalid",
      "<p>We could not confirm this sign-in request (it may have expired or been opened in a different browser). Please start again.</p>",
    );
  }
  if (params.get("error")) {
    return fail("Google sign-in failed", "<p>Google reported a problem during sign-in. Please try again.</p>", 400, returnTo);
  }
  const code = params.get("code");
  if (!code) return fail("Google sign-in failed", "<p>Google did not return an authorization code. Please try again.</p>", 400, returnTo);

  let tokens;
  let identity;
  try {
    tokens = await d.google.exchangeCode({ code, redirectUri: `${d.baseUrl}${CALLBACK_PATH}`, codeVerifier: saved.verifier });
    identity = d.google.verifyIdToken(tokens.idToken);
  } catch (err) {
    if (err instanceof EmailNotVerifiedError) {
      return fail(
        "Verify your Google email first",
        "<p>The email address on this Google account is not verified, so we cannot sign you in with it. Verify it in your Google account settings, or use a different Google account.</p>",
        403,
        returnTo,
      );
    }
    return fail("Google sign-in failed", "<p>We could not complete the sign-in with Google. Please try again.</p>", 502, returnTo);
  }

  const missing = missingScopes(tokens.scope);
  if (missing.length > 0) {
    const names: Record<string, string> = {
      [REQUIRED_SCOPES[0]]: "Google Analytics (read-only)",
      [REQUIRED_SCOPES[1]]: "Search Console (read-only)",
    };
    const list = missing.map((s) => `<li>${escapeHtml(names[s] ?? s)}</li>`).join("");
    return fail(
      "Permissions missing",
      `<p>Google did not grant everything we need. Missing access:</p><ul>${list}</ul><p>On the Google consent screen, leave all of the requested checkboxes ticked, then continue.</p>`,
      400,
      returnTo,
    );
  }
  if (!tokens.refreshToken) {
    return fail(
      "Google did not allow offline access",
      "<p>Google did not give us a refresh token, so we could not keep reading your data between sessions. Please try again and approve all of the requested access. If it keeps happening, remove this app at myaccount.google.com/permissions and connect again.</p>",
      400,
      returnTo,
    );
  }

  const now = new Date(d.now());
  const grant = await d.repo.findPendingGrant(identity.email.toLowerCase());
  // A returning account that deleted its data keeps its previous plan state (no fresh trial, no lifted suspension).
  // An explicit admin grant still wins.
  const tomb = grant ? null : await d.repo.findTombstone(sha256Hex(identity.sub));
  const plan = grant?.plan ?? tomb?.plan ?? d.defaultPlan ?? DEFAULT_PLAN_FOR_NEW_USERS;
  const trialEndsAt = tomb
    ? tomb.trialEndsAt
    : plan === "internal"
      ? null
      : new Date(now.getTime() + d.trialDays * 86_400_000);
  const user = await d.repo.upsertUser({
    googleSub: identity.sub,
    email: identity.email,
    name: identity.name,
    now,
    newUser: { plan, trialEndsAt },
  });
  if (grant && user.created) {
    await d.repo.markGrantApplied(identity.email.toLowerCase(), now);
    await d.repo.audit({ actor: "system", action: "admin.grant.applied", target: user.id, meta: { plan: grant.plan } });
  }
  const enc = d.encrypt(tokens.refreshToken);
  await d.repo.upsertConnection({
    userId: user.id,
    googleSub: identity.sub,
    googleEmail: identity.email,
    refreshTokenEnc: enc.payload,
    encKeyVersion: enc.keyVersion,
    scopes: tokens.scope.split(/\s+/).filter(Boolean),
    now,
  });
  await d.repo.audit({ actor: `user:${user.id}`, action: "google.connect", target: user.id, meta: { newUser: user.created } });

  const session = createSessionCookie({ userId: user.id, email: user.email }, { secret: () => d.sessionSecret, now: d.now });
  return redirect(`${d.baseUrl}${returnTo}`, [session, clearState]);
}
