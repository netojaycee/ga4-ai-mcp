import type { Metadata } from "next";
import { brand, brandNameFallback } from "@/config/brand";
import { SiteShell } from "../_components/site-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Terms of service | ${brandNameFallback()}` };

export default function Terms() {
  const b = brand();
  return (
    <SiteShell name={b.name}>
      <h1 className="text-3xl font-bold">Terms of service</h1>
      <p className="opacity-70">Last updated: 6 October 2026</p>

      <h2 className="text-xl font-semibold">The service</h2>
      <p>
        {b.name} provides read-only access to your Google Analytics 4 and Google Search Console data for AI assistants
        you connect. By using it you agree to these terms.
      </p>

      <h2 className="text-xl font-semibold">Early access</h2>
      <p>
        The service is in early access. It may change, be limited or be unavailable, and features, limits and trial
        periods can change. We may suspend or end access, including for misuse.
      </p>

      <h2 className="text-xl font-semibold">Your account and data</h2>
      <p>
        You must have the right to access the Google properties you connect, and you are responsible for what you ask
        your assistant to do with the results. You can disconnect and delete your data at any time from the{" "}
        <a className="underline" href="/account">account page</a>. How we handle data is described in the{" "}
        <a className="underline" href="/privacy">privacy policy</a>.
      </p>

      <h2 className="text-xl font-semibold">Acceptable use</h2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Do not attempt to bypass limits, probe or disrupt the service, or access other people&rsquo;s data.</li>
        <li>Do not use the service to break the law or Google&rsquo;s terms, or to resell access without permission.</li>
        <li>Do not overload the service with automated requests beyond your plan limits.</li>
      </ul>

      <h2 className="text-xl font-semibold">AI output</h2>
      <p>
        Answers produced by AI assistants can be wrong or incomplete. Check important figures against Google Analytics
        and Search Console before you rely on them.
      </p>

      <h2 className="text-xl font-semibold">No warranty and limit of liability</h2>
      <p>
        The service is provided &ldquo;as is&rdquo; without warranties of any kind. To the extent the law allows, we
        are not liable for indirect or consequential losses, or for losses from decisions made using the service, and
        our total liability is limited to the amount you paid us in the previous 12 months (or zero for free use).
      </p>

      <h2 className="text-xl font-semibold">Third parties</h2>
      <p>
        Your use of Google, ChatGPT, Claude and other services is governed by their own terms. {b.name} is not
        affiliated with them.
      </p>

      <h2 className="text-xl font-semibold">Changes and contact</h2>
      <p>
        We may update these terms; continued use means you accept the update.
        {b.supportEmail ? (
          <>
            {" "}Contact: <a className="underline" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>.
          </>
        ) : null}
      </p>
    </SiteShell>
  );
}
