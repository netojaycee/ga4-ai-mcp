import type { Metadata } from "next";
import { brand, brandNameFallback } from "@/config/brand";
import { SiteShell } from "../_components/site-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Setup guide | ${brandNameFallback()}` };

export default function Setup() {
  const b = brand();
  const code = "rounded bg-black/10 px-2 py-1 break-all dark:bg-white/10";
  return (
    <SiteShell name={b.name}>
      <h1 className="text-3xl font-bold">Setup guide</h1>
      <p>
        Connect your AI assistant to your Google Analytics 4 and Search Console data in about two minutes. Access is{" "}
        <strong>read-only</strong>.
      </p>

      <section aria-labelledby="before" className="space-y-2">
        <h2 id="before" className="text-xl font-semibold">
          Before you start
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            Server URL (you will paste this into your AI app): <code className={code}>{b.mcpUrl}</code>
          </li>
          <li>
            <strong>Use the right Google account.</strong> When Google asks you to sign in, pick the account that can
            already open your Analytics and Search Console properties (usually your work account). The assistant can only
            see what that account can see. Your AI app login (for example ChatGPT) and your Google login are separate:
            you choose the Google account only at the Google step below.
          </li>
          <li>Ask your administrator to approve your email first if you were told to. It gives you the team plan.</li>
        </ul>
      </section>

      <section aria-labelledby="flow" className="space-y-2">
        <h2 id="flow" className="text-xl font-semibold">
          What happens when you connect
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          <li>Your AI app opens {b.name} and asks you to sign in.</li>
          <li>
            <strong>Google sign-in:</strong> pick your work Google account and approve read-only access to Analytics and
            Search Console.
          </li>
          <li>
            Google may show a warning that the app is not verified while we are in early access. Choose{" "}
            <strong>Advanced</strong>, then <strong>Go to {b.name} (unsafe)</strong>. This is expected.
          </li>
          <li>
            Click <strong>Approve</strong> on our page to let your AI app use the connection. You are done.
          </li>
        </ol>
      </section>

      <section aria-labelledby="youtube" className="space-y-2">
        <h2 id="youtube" className="text-xl font-semibold">
          Adding YouTube (optional)
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          <li>
            After you have connected once, open <a className="underline" href="/account">your account page</a> in the
            same browser.
          </li>
          <li>
            Click <strong>Connect YouTube</strong>, choose your Google account, then pick the channel to share (brand
            channels appear in the list), and approve read-only access.
          </li>
          <li>
            Ask your assistant, for example: &ldquo;Show my top 10 YouTube videos from the last 28 days.&rdquo;
          </li>
        </ol>
      </section>

      <section aria-labelledby="chatgpt" className="space-y-2">
        <h2 id="chatgpt" className="text-xl font-semibold">
          ChatGPT
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          <li>
            Open <strong>chatgpt.com/plugins</strong>, click <strong>Add</strong>, then{" "}
            <strong>Create custom MCP server</strong>. If you do not see it, your plan or workspace admin may block
            custom servers; ask your ChatGPT admin.
          </li>
          <li>
            Name: <code>{b.name}</code>. Connection: Server URL, paste the URL above. Authentication: OAuth.
          </li>
          <li>Tick the risk acknowledgement and click Create, then Continue and follow the flow above.</li>
          <li>
            In a new chat type <code>@{b.name}</code> and ask, for example: &ldquo;List my GA4 properties&rdquo;.
          </li>
        </ol>
      </section>

      <section aria-labelledby="claude" className="space-y-2">
        <h2 id="claude" className="text-xl font-semibold">
          Claude
        </h2>
        <ol className="list-decimal space-y-1 pl-6">
          <li>Settings, Customize, Connectors, Add custom connector.</li>
          <li>Paste the URL above, keep the defaults, and click Add, then Connect.</li>
          <li>Follow the flow above, then start a chat and ask about your data.</li>
        </ol>
      </section>

      <section aria-labelledby="others" className="space-y-2">
        <h2 id="others" className="text-xl font-semibold">
          Claude Code, Cursor, VS Code and others
        </h2>
        <p>
          Claude Code: <code className={code}>claude mcp add --transport http insights {b.mcpUrl}</code>, then run{" "}
          <code>/mcp</code> to sign in. For other tools, add a remote (HTTP) MCP server with the URL above.
        </p>
      </section>

      <section aria-labelledby="try" className="space-y-2">
        <h2 id="try" className="text-xl font-semibold">
          Things to ask
        </h2>
        <ul className="list-disc space-y-1 pl-6">
          <li>&ldquo;List my GA4 properties.&rdquo;</li>
          <li>&ldquo;Top 20 pages by sessions in the last 30 days for property &lt;name&gt;.&rdquo;</li>
          <li>&ldquo;Which search queries lost clicks this month in Search Console?&rdquo;</li>
        </ul>
      </section>

      <section aria-labelledby="trouble" className="space-y-2">
        <h2 id="trouble" className="text-xl font-semibold">
          Troubleshooting
        </h2>
        <ul className="list-disc space-y-2 pl-6">
          <li>
            <strong>Wrong Google account connected, or no properties listed:</strong> open your{" "}
            <a className="underline" href="/account">account page</a>, choose Disconnect, then connect again and pick the
            correct Google account.
          </li>
          <li>
            <strong>&ldquo;Please reconnect&rdquo;:</strong> sign in again at the <a className="underline" href="/account">account page</a>.
          </li>
          <li>
            <strong>&ldquo;Too many requests&rdquo;:</strong> you hit your plan&rsquo;s per-minute or daily limit; wait and retry.
          </li>
          <li>
            <strong>Still stuck:</strong> contact your administrator
            {b.supportEmail ? <> or <a className="underline" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a></> : null}.
          </li>
        </ul>
        <p>
          You can disconnect and delete your data any time from your <a className="underline" href="/account">account page</a>.
        </p>
      </section>
    </SiteShell>
  );
}
