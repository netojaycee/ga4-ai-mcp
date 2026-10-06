import { brand } from "@/config/brand";
import { SiteShell } from "./_components/site-shell";

export const dynamic = "force-dynamic";

const steps = [
  ["ChatGPT", "Settings, Apps & Connectors, enable Developer mode, then Create and paste the server URL below. Choose OAuth when asked."],
  ["Claude", "Settings, Connectors, Add custom connector, and paste the server URL below."],
  ["Cursor, VS Code, Claude Code and other MCP clients", "Add a remote (HTTP) MCP server with the URL below and sign in when prompted."],
];

export default function Home() {
  const b = brand();
  return (
    <SiteShell name={b.name}>
      <h1 className="text-3xl font-bold">{b.name}</h1>
      <p className="text-lg">{b.tagline}</p>
      <p>
        Sign in with Google once, then ask your AI assistant questions about your traffic, conversions and search
        performance. Access is <strong>read-only</strong>: the assistant can look at your data, never change it.
      </p>

      <section aria-labelledby="url" className="space-y-2">
        <h2 id="url" className="text-xl font-semibold">
          Server URL
        </h2>
        <p>
          <code className="rounded bg-black/10 px-2 py-1 break-all dark:bg-white/10">{b.mcpUrl}</code>
        </p>
      </section>

      <section aria-labelledby="how" className="space-y-3">
        <h2 id="how" className="text-xl font-semibold">
          How to connect
        </h2>
        <ol className="list-decimal space-y-3 pl-6">
          {steps.map(([who, what]) => (
            <li key={who}>
              <strong>{who}.</strong> {what}
            </li>
          ))}
        </ol>
        <p>
          You will be sent to Google to approve read-only access to Google Analytics and Search Console. While the app is
          in early access, Google may show an &ldquo;unverified app&rdquo; notice; choose Advanced to continue.
        </p>
      </section>

      <section aria-labelledby="control" className="space-y-2">
        <h2 id="control" className="text-xl font-semibold">
          You stay in control
        </h2>
        <p>
          You can disconnect Google and delete your data any time from your <a className="underline" href="/account">account page</a>.
          See the <a className="underline" href="/privacy">privacy policy</a> for exactly what is stored.
        </p>
      </section>
    </SiteShell>
  );
}
