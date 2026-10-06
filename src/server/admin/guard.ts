import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { env } from "@/config/env";
import { connectStartPath, getSessionUserFromCookieHeader } from "@/server/auth/session";

/**
 * Admin access, shared by all /admin pages and actions.
 * Admin = a valid first-party session user (see src/server/auth/session.ts) whose email is in ADMIN_EMAILS.
 */
export interface AdminUser {
  userId: string;
  email: string;
}

export function isAdminEmail(email: string, adminEmails: readonly string[] = env().ADMIN_EMAILS): boolean {
  const e = email.trim().toLowerCase();
  return adminEmails.some((a) => a.trim().toLowerCase() === e);
}

export type AdminCheck = { kind: "admin"; admin: AdminUser } | { kind: "logged_out" } | { kind: "not_admin" };

/** Pure decision used by requireAdmin; the session lookup is injectable for tests. */
export async function checkAdmin(
  cookieHeader: string | null,
  lookup: (cookie: string | null) => Promise<{ userId: string; email: string } | null> = getSessionUserFromCookieHeader,
  adminEmails?: readonly string[],
): Promise<AdminCheck> {
  const user = await lookup(cookieHeader);
  if (!user) return { kind: "logged_out" };
  if (!isAdminEmail(user.email, adminEmails)) return { kind: "not_admin" };
  return { kind: "admin", admin: { userId: user.userId, email: user.email } };
}

/** Returns the admin for this Cookie header, or null (not logged in, or not an admin). */
export async function getAdminFromCookieHeader(cookieHeader: string | null): Promise<AdminUser | null> {
  const r = await checkAdmin(cookieHeader);
  return r.kind === "admin" ? r.admin : null;
}

/**
 * For server components and server actions. Logged out: redirect to the Google sign-in start with
 * return_to=/admin. Logged in but not an admin: respond as if the page does not exist (404).
 */
export async function requireAdmin(): Promise<AdminUser> {
  const result = await checkAdmin((await headers()).get("cookie"));
  if (result.kind === "logged_out") redirect(connectStartPath("/admin"));
  if (result.kind === "not_admin") notFound();
  return result.admin;
}
