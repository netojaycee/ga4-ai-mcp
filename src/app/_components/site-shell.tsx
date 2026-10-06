import Link from "next/link";
import type { ReactNode } from "react";

export function SiteShell({ name, children }: { name: string; children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-3xl flex-col px-5 py-8">
      <header className="mb-10 flex items-center justify-between">
        <Link href="/" className="text-lg font-semibold">
          {name}
        </Link>
        <nav className="flex gap-5 text-sm">
          <Link href="/privacy" className="underline-offset-4 hover:underline">
            Privacy
          </Link>
          <Link href="/terms" className="underline-offset-4 hover:underline">
            Terms
          </Link>
          <Link href="/account" className="underline-offset-4 hover:underline">
            Account
          </Link>
        </nav>
      </header>
      <main className="flex-1 space-y-6 leading-7">{children}</main>
      <footer className="mt-12 border-t pt-6 text-sm opacity-70">
        <p>
          {name} is an independent service. It is not affiliated with or endorsed by Google, OpenAI or Anthropic.
          Google Analytics and Google Search Console are trademarks of Google LLC.
        </p>
      </footer>
    </div>
  );
}
