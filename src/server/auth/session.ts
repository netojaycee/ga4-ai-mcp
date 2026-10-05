/**
 * Contract between the OAuth authorize endpoint (src/server/oauth) and the Google connect flow
 * (src/app/api/connect/google). The connect flow owns the real implementation.
 *
 * STUB: always anonymous until the connect-flow task replaces the body. Keep the exports stable.
 */
export interface SessionUser {
  userId: string;
  email: string;
}

/** Reads the signed first-party session cookie. Null means "not logged in". */
export async function getSessionUser(_req: Request): Promise<SessionUser | null> {
  return null;
}

/** Where /oauth/authorize sends a logged-out user. `returnTo` must be a same-origin path. */
export function connectStartPath(returnTo: string): string {
  return `/api/connect/google/start?return_to=${encodeURIComponent(returnTo)}`;
}
