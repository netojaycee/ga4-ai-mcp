import type { Metadata } from "next";
import { headers } from "next/headers";
import { env } from "@/config/env";
import { brand } from "@/config/brand";
import { csrfTokenFor, getSessionUserFromCookieHeader } from "@/server/auth/session";
import { connectStartPath } from "@/server/auth/session";
import { GOOGLE_SCOPE_YOUTUBE, GOOGLE_SCOPE_YOUTUBE_ANALYTICS } from "@/server/connect/google";
import { drizzleConnectRepository } from "@/server/connect/repository";
import { SiteShell } from "../_components/site-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const MESSAGES: Record<string, string> = {
  disconnected: "Google has been disconnected and your AI client tokens were revoked.",
  deleted: "Your data was deleted and you have been signed out.",
  signedout: "You have been signed out of this browser.",
};

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "none");

function Notice({ children }: { children: string }) {
  return (
    <p role="status" className="rounded-xl border border-line bg-accent-soft px-4 py-3 text-sm font-medium text-accent">
      {children}
    </p>
  );
}

function Row({ title, detail, badge, action }: { title: string; detail: string; badge: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 py-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <h3 className="font-semibold">{title}</h3>
          {badge}
        </div>
        <p className="mt-1 break-all text-sm text-muted">{detail}</p>
      </div>
      {action}
    </div>
  );
}

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const cookie = (await headers()).get("cookie");
  const user = await getSessionUserFromCookieHeader(cookie);
  const account = user ? await drizzleConnectRepository().getAccount(user.userId) : null;
  const notice = msg ? MESSAGES[msg] : undefined;
  const b = brand();

  if (!user || !account) {
    return (
      <SiteShell name={b.name} prose={false}>
        <div className="mx-auto max-w-lg space-y-5 py-8 text-center">
          {notice && <Notice>{notice}</Notice>}
          <h1 className="text-3xl font-extrabold tracking-tight">Connect your account</h1>
          <p className="text-muted">
            Sign in with Google to let your AI assistant read your Google Analytics 4 and Search Console data
            (read-only).
          </p>
          <a href={connectStartPath("/account")} className="btn btn-primary">
            Connect Google
          </a>
        </div>
      </SiteShell>
    );
  }

  const csrf = csrfTokenFor(cookie, env().SESSION_SECRET) ?? "";
  const connected = account.connectionStatus === "active";
  const youtubeOn = account.scopes.includes(GOOGLE_SCOPE_YOUTUBE) && account.scopes.includes(GOOGLE_SCOPE_YOUTUBE_ANALYTICS);
  const planBadge = <span className="badge badge-accent">{account.plan}</span>;

  return (
    <SiteShell name={b.name} prose={false}>
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight">Your account</h1>
          <p className="mt-1 text-muted">
            Signed in as <strong className="text-foreground">{account.email}</strong>
          </p>
        </div>
        {notice && <Notice>{notice}</Notice>}

        <section aria-labelledby="conn-h" className="card divide-y divide-line !py-2">
          <h2 id="conn-h" className="sr-only">
            Connections
          </h2>
          <Row
            title="Google Analytics and Search Console"
            detail={connected ? (account.googleEmail ?? "") : "Not connected yet"}
            badge={<span className={connected ? "badge badge-ok" : "badge"}>{connected ? "Connected" : "Not connected"}</span>}
            action={
              !connected && (
                <a href={connectStartPath("/account")} className="btn btn-primary">
                  Connect Google
                </a>
              )
            }
          />
          {connected && (
            <Row
              title="YouTube"
              detail={
                youtubeOn
                  ? "Read-only. To switch channel, reconnect and pick the channel on Google's screen."
                  : "Let your AI assistant read your YouTube channel's analytics (read-only)."
              }
              badge={<span className={youtubeOn ? "badge badge-ok" : "badge"}>{youtubeOn ? "Connected" : "Optional"}</span>}
              action={
                <a href={connectStartPath("/account", "youtube")} className={youtubeOn ? "btn" : "btn btn-primary"}>
                  {youtubeOn ? "Reconnect YouTube" : "Connect YouTube"}
                </a>
              }
            />
          )}
        </section>

        <section aria-labelledby="plan-h" className="card">
          <h2 id="plan-h" className="text-lg font-semibold">
            Plan
          </h2>
          <dl className="mt-3 grid grid-cols-2 gap-4 text-sm">
            <div>
              <dt className="text-muted">Current plan</dt>
              <dd className="mt-1">{planBadge}</dd>
            </div>
            <div>
              <dt className="text-muted">Trial ends</dt>
              <dd className="mt-1 font-medium">{fmt(account.trialEndsAt)}</dd>
            </div>
          </dl>
        </section>

        <section aria-labelledby="signout-h" className="card flex flex-wrap items-center justify-between gap-4">
          <div className="max-w-md">
            <h2 id="signout-h" className="text-lg font-semibold">
              Sign out
            </h2>
            <p className="mt-1 text-sm text-muted">Ends your session in this browser only. Your Google connection and AI clients stay as they are.</p>
          </div>
          <form method="post" action="/api/connect/logout">
            <input type="hidden" name="csrf" value={csrf} />
            <button type="submit" className="btn">
              Sign out
            </button>
          </form>
        </section>

        <section aria-labelledby="danger-h" className="card space-y-5 !border-[color:var(--danger)]/40">
          <h2 id="danger-h" className="text-lg font-semibold text-[color:var(--danger)]">
            Danger zone
          </h2>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="max-w-md">
              <h3 id="disconnect-h" className="font-semibold">
                Disconnect Google
              </h3>
              <p className="mt-1 text-sm text-muted">
                Revokes our access at Google and signs all your AI clients out. Your account stays so you can reconnect later.
              </p>
            </div>
            <form method="post" action="/api/connect/account/disconnect">
              <input type="hidden" name="csrf" value={csrf} />
              <button type="submit" className="btn btn-danger" disabled={!connected}>
                Disconnect
              </button>
            </form>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4 border-t border-line pt-5">
            <div className="max-w-md">
              <h3 id="delete-h" className="font-semibold">
                Delete my data
              </h3>
              <p className="mt-1 text-sm text-muted">
                Disconnects Google, revokes all AI client tokens and permanently deletes your account. This cannot be undone.
              </p>
            </div>
            <form method="post" action="/api/connect/account/delete">
              <input type="hidden" name="csrf" value={csrf} />
              <button type="submit" className="btn btn-danger-solid">
                Delete my data
              </button>
            </form>
          </div>
        </section>
      </div>
    </SiteShell>
  );
}
