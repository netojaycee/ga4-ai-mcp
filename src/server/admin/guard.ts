/**
 * Contract for admin access, shared by all /admin pages and actions.
 * STUB until the admin-core task replaces the bodies. Keep the exports and signatures stable.
 *
 * Admin = a valid first-party session user (see src/server/auth/session.ts) whose email is in ADMIN_EMAILS.
 */
export interface AdminUser {
  userId: string;
  email: string;
}

/** Returns the admin for this Cookie header, or null (not logged in, or not an admin). */
export async function getAdminFromCookieHeader(_cookieHeader: string | null): Promise<AdminUser | null> {
  return null;
}

/**
 * For server components and server actions. Logged out: redirect to the Google sign-in start with
 * return_to=/admin. Logged in but not an admin: respond as if the page does not exist (404).
 */
export async function requireAdmin(): Promise<AdminUser> {
  throw new Error("requireAdmin is not implemented yet");
}
