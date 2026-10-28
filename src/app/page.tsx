import Link from "next/link";
import { brand } from "@/config/brand";
import { SiteShell } from "./_components/site-shell";

export const dynamic = "force-dynamic";

const features = [
  ["Google Analytics 4", "Traffic, conversions, top pages and realtime activity, across all your properties."],
  ["Search Console", "Queries, pages, clicks and indexing status, straight from Google."],
  ["YouTube", "Channel views, watch time, subscribers and your best videos. Connect it when you want it."],
] as const;

const clients = [
  ["ChatGPT", "Open chatgpt.com/plugins, Add, Create custom MCP server, paste the server URL and choose OAuth."],
  ["Claude", "Settings, Customize, Connectors, Add custom connector, and paste the server URL."],
  ["Cursor, VS Code, Claude Code and others", "Add a remote (HTTP) MCP server with the URL and sign in when prompted."],
] as const;

const trust = [
  ["Read-only", "Your assistant can look at your data, never change it."],
  ["Nothing stored", "Analytics data is fetched when you ask and never kept."],
  ["Encrypted tokens", "Google access is stored encrypted and never handed to your AI app."],
  ["Disconnect any time", "Revoke access and delete your data from your account page."],
] as const;

function Check() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden className="mt-1 flex-none text-accent">
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export default function Home() {
  const b = brand();
  return (
    <SiteShell name={b.name} wide prose={false}>
      <section className="py-8 text-center sm:py-14">
        <span className="eyebrow">Read-only · Works with ChatGPT, Claude, Cursor and more</span>
        <h1 className="mx-auto mt-5 max-w-3xl text-4xl font-extrabold tracking-tight sm:text-5xl">
          Ask your AI about your <span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">analytics</span>
        </h1>
        <p className="mx-auto mt-5 max-w-2xl text-lg text-muted">
          Sign in with Google once, then ask questions about your traffic, search performance and YouTube channel in
          plain language. {b.name} gives your assistant read-only access, nothing more.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/setup" className="btn btn-primary">
            Get started
          </Link>
          <Link href="/account" className="btn">
            Connect your account
          </Link>
        </div>
      </section>

      <section aria-labelledby="url" className="card mx-auto max-w-2xl space-y-3">
        <h2 id="url" className="text-lg font-semibold">
          Your server URL
        </h2>
        <p className="text-sm text-muted">Paste this into your AI app when it asks for a connector or MCP server. Click it to select it.</p>
        <code className="kbd-url">{b.mcpUrl}</code>
      </section>

      <section aria-labelledby="what" className="mt-14">
        <h2 id="what" className="text-center text-2xl font-bold tracking-tight">
          What you can ask about
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {features.map(([title, text]) => (
            <div key={title} className="card">
              <h3 className="font-semibold">{title}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <section aria-labelledby="how" className="mt-14">
        <h2 id="how" className="text-center text-2xl font-bold tracking-tight">
          Connect in two minutes
        </h2>
        <div className="mt-6 grid gap-4 sm:grid-cols-3">
          {clients.map(([who, what], i) => (
            <div key={who} className="card">
              <span className="step-num">{i + 1}</span>
              <h3 className="mt-3 font-semibold">{who}</h3>
              <p className="mt-2 text-sm leading-6 text-muted">{what}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-sm text-muted">
          You will be sent to Google to approve read-only access. While the app is in early access, Google may show an
          &ldquo;unverified app&rdquo; notice: choose Advanced to continue. Need more detail?{" "}
          <Link href="/setup" className="text-accent underline underline-offset-4">
            Read the setup guide
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="google-data" className="card mt-14 space-y-3">
        <h2 id="google-data" className="text-2xl font-bold tracking-tight">
          How {b.name} uses your Google data
        </h2>
        <p className="text-muted">
          {b.name} is a connector: it lets an AI assistant that <em>you</em> choose (ChatGPT, Claude, Cursor and
          similar) read your own Google Analytics 4, Google Search Console and, if you opt in, YouTube channel data, so
          you can ask questions about it in plain language. It requests read-only access, only for the accounts you sign
          in with, and only when you ask a question.
        </p>
        <ul className="list-disc space-y-1 pl-6 text-muted">
          <li>We never change, create or delete anything in your Google accounts.</li>
          <li>We do not store your analytics, Search Console or YouTube data, and we never sell it or use it for advertising.</li>
          <li>We do not use it to train AI or machine-learning models.</li>
          <li>
            {b.name} does not generate, edit or distribute images or video, and cannot be used to create
            non-consensual or intimate imagery.
          </li>
        </ul>
        <p className="text-muted">
          {b.name}&rsquo;s use and transfer of information received from Google APIs adheres to the{" "}
          <a className="text-accent underline underline-offset-4" href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements. When you connect YouTube you also agree to the{" "}
          <a className="text-accent underline underline-offset-4" href="https://www.youtube.com/t/terms">
            YouTube Terms of Service
          </a>
          . Read our{" "}
          <Link href="/privacy" className="text-accent underline underline-offset-4">
            privacy policy
          </Link>{" "}
          and{" "}
          <Link href="/terms" className="text-accent underline underline-offset-4">
            terms of service
          </Link>
          .
        </p>
      </section>

      <section aria-labelledby="control" className="mt-14">
        <h2 id="control" className="text-center text-2xl font-bold tracking-tight">
          You stay in control
        </h2>
        <ul className="mt-6 grid gap-4 sm:grid-cols-2">
          {trust.map(([title, text]) => (
            <li key={title} className="card flex gap-3">
              <Check />
              <div>
                <h3 className="font-semibold">{title}</h3>
                <p className="mt-1 text-sm leading-6 text-muted">{text}</p>
              </div>
            </li>
          ))}
        </ul>
        <p className="mt-5 text-center text-sm text-muted">
          See the{" "}
          <Link href="/privacy" className="text-accent underline underline-offset-4">
            privacy policy
          </Link>{" "}
          for exactly what is stored, or manage your connection on your{" "}
          <Link href="/account" className="text-accent underline underline-offset-4">
            account page
          </Link>
          .
        </p>
      </section>
    </SiteShell>
  );
}
