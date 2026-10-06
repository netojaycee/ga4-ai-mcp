import type { Metadata } from "next";
import { headers } from "next/headers";
import { env } from "@/config/env";
import { brand } from "@/config/brand";
import { csrfTokenFor, getSessionUserFromCookieHeader } from "@/server/auth/session";
import { connectStartPath } from "@/server/auth/session";
import { drizzleConnectRepository } from "@/server/connect/repository";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Your account", robots: { index: false } };

const MESSAGES: Record<string, string> = {
  disconnected: "Google has been disconnected and your AI client tokens were revoked.",
  deleted: "Your data was deleted and you have been signed out.",
};

const fmt = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "none");

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ msg?: string }> }) {
  const { msg } = await searchParams;
  const cookie = (await headers()).get("cookie");
  const user = await getSessionUserFromCookieHeader(cookie);
  const account = user ? await drizzleConnectRepository().getAccount(user.userId) : null;
  const notice = msg ? MESSAGES[msg] : undefined;
  const wrap = { maxWidth: "40rem", margin: "3rem auto", padding: "0 1rem", font: "16px/1.5 system-ui, sans-serif" } as const;

  if (!user || !account) {
    return (
      <main style={wrap}>
        <h1>{brand().name}</h1>
        {notice && <p role="status">{notice}</p>}
        <p>Connect your Google account to let your AI assistant read your Google Analytics 4 and Search Console data (read-only).</p>
        <p>
          <a href={connectStartPath("/account")}>Connect Google</a>
        </p>
      </main>
    );
  }

  const csrf = csrfTokenFor(cookie, env().SESSION_SECRET) ?? "";
  const connected = account.connectionStatus === "active";
  return (
    <main style={wrap}>
      <h1>Your account</h1>
      {notice && <p role="status">{notice}</p>}
      <dl>
        <dt>Signed in as</dt>
        <dd>{account.email}</dd>
        <dt>Connected Google account</dt>
        <dd>{connected ? account.googleEmail : "Not connected"}</dd>
        <dt>Plan</dt>
        <dd>{account.plan}</dd>
        <dt>Trial ends</dt>
        <dd>{fmt(account.trialEndsAt)}</dd>
      </dl>
      {!connected && (
        <p>
          <a href={connectStartPath("/account")}>Connect Google</a>
        </p>
      )}
      <section aria-labelledby="disconnect-h">
        <h2 id="disconnect-h">Disconnect Google</h2>
        <p>Revokes our access at Google and signs your AI clients out. Your account stays so you can reconnect later.</p>
        <form method="post" action="/api/connect/account/disconnect">
          <input type="hidden" name="csrf" value={csrf} />
          <button type="submit" disabled={!connected}>
            Disconnect
          </button>
        </form>
      </section>
      <section aria-labelledby="delete-h">
        <h2 id="delete-h">Delete my data</h2>
        <p>Disconnects Google, revokes all AI client tokens and permanently deletes your account. This cannot be undone.</p>
        <form method="post" action="/api/connect/account/delete">
          <input type="hidden" name="csrf" value={csrf} />
          <button type="submit">Delete my data</button>
        </form>
      </section>
    </main>
  );
}
