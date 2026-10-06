import type { Metadata } from "next";
import Link from "next/link";
import { requireAdmin } from "@/server/admin/guard";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false } };

const NAV = [
  { href: "/admin", label: "Users" },
  { href: "/admin/grants", label: "Team access" },
  { href: "/admin/usage", label: "Usage" },
  { href: "/admin/audit", label: "Audit log" },
  { href: "/admin/invites", label: "Invites" },
] as const;

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  // Pages and actions call requireAdmin() themselves; this is for the signed-in email only.
  const admin = await requireAdmin();
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-neutral-300 pb-3 dark:border-neutral-700">
        <nav aria-label="Admin" className="flex flex-wrap gap-1">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              className="rounded px-3 py-1.5 text-sm font-medium hover:bg-neutral-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 dark:hover:bg-neutral-800"
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <p className="text-sm text-neutral-600 dark:text-neutral-400">
          Signed in as <strong>{admin.email}</strong> ·{" "}
          <Link href="/account" className="underline focus-visible:outline-2 focus-visible:outline-blue-600">
            My account
          </Link>
        </p>
      </header>
      <main>{children}</main>
    </div>
  );
}
