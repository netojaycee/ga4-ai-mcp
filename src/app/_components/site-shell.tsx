import Link from "next/link";
import type { ReactNode } from "react";

function LogoMark() {
  return (
    <span
      aria-hidden
      className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-sm"
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 20V10M10 20V4M16 20v-7M22 20H2" />
      </svg>
    </span>
  );
}

const nav = [
  ["/setup", "Setup"],
  ["/privacy", "Privacy"],
  ["/terms", "Terms"],
] as const;

export function SiteShell({
  name,
  children,
  wide = false,
  prose = true,
}: {
  name: string;
  children: ReactNode;
  /** Wider canvas for the home page. */
  wide?: boolean;
  /** Style plain headings, lists and links (legal and guide pages). */
  prose?: boolean;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-10 border-b border-line bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-3">
          <Link href="/" className="flex items-center gap-2.5 text-base font-semibold tracking-tight">
            <LogoMark />
            {name}
          </Link>
          <nav className="flex items-center gap-1 text-sm sm:gap-2">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="hidden rounded-lg px-3 py-2 text-muted hover:text-foreground sm:inline-block">
                {label}
              </Link>
            ))}
            <Link href="/account" className="btn btn-primary !py-2">
              Account
            </Link>
          </nav>
        </div>
      </header>

      <main className={`mx-auto w-full flex-1 px-5 py-10 ${wide ? "max-w-5xl" : "max-w-3xl"}`}>
        <div className={prose ? "prose-page space-y-4 leading-7" : ""}>{children}</div>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto max-w-5xl space-y-3 px-5 py-8 text-sm text-muted">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {nav.map(([href, label]) => (
              <Link key={href} href={href} className="hover:text-foreground">
                {label}
              </Link>
            ))}
            <Link href="/account" className="hover:text-foreground">
              Account
            </Link>
          </div>
          <p>
            {name} is an independent service. It is not affiliated with or endorsed by Google, YouTube, OpenAI or
            Anthropic. Google Analytics, Google Search Console and YouTube are trademarks of Google LLC.
          </p>
        </div>
      </footer>
    </div>
  );
}
