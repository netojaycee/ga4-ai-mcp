import { eq } from "drizzle-orm";
import { env } from "@/config/env";
import { db } from "@/server/db/client";
import { users } from "@/server/db/schema";
import {
  isProduction,
  mac,
  readCookie,
  serializeCookie,
  signPayload,
  verifyPayload,
} from "@/server/connect/signed";
import { safeEqual } from "@/server/security/hash";

/**
 * First-party session shared by the OAuth authorize endpoint (src/server/oauth) and the Google connect
 * flow (src/app/api/connect/google). Signed (HMAC-SHA256, SESSION_SECRET), httpOnly, SameSite=Lax, Secure in prod.
 */
export interface SessionUser {
  userId: string;
  email: string;
}

export const SESSION_COOKIE = "ga_session";
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;

interface SessionPayload {
  /** Domain separation: other signed cookies (e.g. the OAuth state cookie) share the secret but not this type. */
  typ: "session";
  uid: string;
  /** Kept for display only; authorization always uses the email re-read from the database. */
  email: string;
  /** Issued-at, unix seconds. */
  iat: number;
  exp: number;
}

export interface UserSessionState {
  email: string;
  authValidAfter: Date | null;
}

export interface SessionDeps {
  secret: () => string;
  now: () => number;
  /** Current database state for the session's user, or null if the user no longer exists. */
  userState?: (userId: string) => Promise<UserSessionState | null>;
  /** Legacy/test shortcut: existence check only (the cookie's email is then trusted and no revocation time applies). */
  userExists?: (userId: string) => Promise<boolean>;
}

const defaultUserState = async (userId: string): Promise<UserSessionState | null> => {
  const [u] = await db()
    .select({ email: users.email, authValidAfter: users.authValidAfter })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return u ?? null;
};

const defaultDeps = {
  secret: () => env().SESSION_SECRET,
  now: () => Date.now(),
};

/** Reads the signed first-party session cookie. Null means "not logged in". */
export async function getSessionUser(req: Request, deps: Partial<SessionDeps> = {}): Promise<SessionUser | null> {
  return getSessionUserFromCookieHeader(req.headers.get("cookie"), deps);
}

export async function getSessionUserFromCookieHeader(
  cookieHeader: string | null | undefined,
  deps: Partial<SessionDeps> = {},
): Promise<SessionUser | null> {
  const d = { ...defaultDeps, ...deps };
  const p = verifyPayload<SessionPayload>(readCookie(cookieHeader, SESSION_COOKIE), d.secret(), Math.floor(d.now() / 1000));
  if (!p || p.typ !== "session" || typeof p.uid !== "string" || typeof p.email !== "string") return null;
  const state: UserSessionState | null = deps.userState
    ? await deps.userState(p.uid)
    : deps.userExists
      ? (await deps.userExists(p.uid))
        ? { email: p.email, authValidAfter: null }
        : null
      : await defaultUserState(p.uid);
  if (!state) return null;
  if (state.authValidAfter && (typeof p.iat === "number" ? p.iat : 0) * 1000 < state.authValidAfter.getTime()) return null;
  return { userId: p.uid, email: state.email };
}

/** Where /oauth/authorize sends a logged-out user. `returnTo` must be a same-origin path. */
export function connectStartPath(returnTo: string): string {
  return `/api/connect/google/start?return_to=${encodeURIComponent(returnTo)}`;
}

/** Set-Cookie header value that logs `user` in. */
export function createSessionCookie(user: SessionUser, deps: Partial<SessionDeps> = {}): string {
  const d = { ...defaultDeps, ...deps };
  const iat = Math.floor(d.now() / 1000);
  const exp = iat + SESSION_TTL_SECONDS;
  const value = signPayload({ typ: "session", uid: user.userId, email: user.email, iat, exp } satisfies SessionPayload, d.secret());
  return serializeCookie(SESSION_COOKIE, value, { maxAgeSeconds: SESSION_TTL_SECONDS, secure: isProduction() });
}

/** Set-Cookie header value that logs the user out. */
export function clearSessionCookie(): string {
  return serializeCookie(SESSION_COOKIE, "", { maxAgeSeconds: 0, secure: isProduction() });
}

/** CSRF token for account POST actions: HMAC bound to the current session cookie value. */
export function csrfTokenFor(cookieHeader: string | null | undefined, secret: string): string | null {
  const session = readCookie(cookieHeader, SESSION_COOKIE);
  return session ? mac(`csrf:${session}`, secret) : null;
}

export function verifyCsrf(
  cookieHeader: string | null | undefined,
  submitted: string | null,
  secret: string,
): boolean {
  const expected = csrfTokenFor(cookieHeader, secret);
  return !!expected && !!submitted && safeEqual(expected, submitted);
}
