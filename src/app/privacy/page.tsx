import type { Metadata } from "next";
import { brand, brandNameFallback } from "@/config/brand";
import { SiteShell } from "../_components/site-shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: `Privacy policy | ${brandNameFallback()}` };

export default function Privacy() {
  const b = brand();
  return (
    <SiteShell name={b.name}>
      <h1 className="text-3xl font-bold">Privacy policy</h1>
      <p className="opacity-70">Last updated: 28 October 2026</p>

      <p>
        {b.name} lets an AI assistant that you choose read your Google Analytics 4, Google Search Console and (if you choose to connect it) YouTube data on
        your behalf. This page explains what we collect, why, and how to remove it.
      </p>

      <h2 className="text-xl font-semibold">What we access from Google</h2>
      <p>With your consent we request these read-only permissions:</p>
      <ul className="list-disc space-y-1 pl-6">
        <li>View your Google Analytics data (<code>analytics.readonly</code>).</li>
        <li>View your Search Console data (<code>webmasters.readonly</code>).</li>
        <li>
          Only if you click <em>Connect YouTube</em>: view your YouTube channel and its analytics (
          <code>youtube.readonly</code>, <code>yt-analytics.readonly</code>). Without that click we never ask for these.
        </li>
        <li>Your Google account email address, name and a unique account identifier, to sign you in.</li>
      </ul>
      <p>We never request permission to change, create or delete anything in your Google accounts.</p>

      <h2 className="text-xl font-semibold">What we store</h2>
      <ul className="list-disc space-y-1 pl-6">
        <li>Your email, name and Google account identifier.</li>
        <li>
          A Google refresh token, which lets us fetch data when you ask. It is stored encrypted and is never shown to
          your AI assistant.
        </li>
        <li>
          Usage records for each request: time, which tool was used, the property or site identifier, whether it
          succeeded, response time and the number of rows returned. These are used for limits, billing readiness,
          reliability and abuse prevention.
        </li>
        <li>Your plan or trial status, and a short log of administrative actions on your account.</li>
      </ul>
      <p>
        <strong>We do not store your analytics, Search Console or YouTube data.</strong> It is fetched from Google at the moment
        you ask a question and passed to the AI assistant you connected. We do not keep a copy.
      </p>

      <h2 className="text-xl font-semibold">How the data is used</h2>
      <p>
        Only to provide the service to you. We do not sell your data, use it for advertising, or use it to train
        machine-learning models. {b.name}&rsquo;s use of information received from Google APIs follows the{" "}
        <a className="underline" href="https://developers.google.com/terms/api-services-user-data-policy">
          Google API Services User Data Policy
        </a>
        , including its Limited Use requirements. If you connect YouTube, you are also agreeing to be bound by the{" "}
        <a className="underline" href="https://www.youtube.com/t/terms">YouTube Terms of Service</a> and the{" "}
        <a className="underline" href="https://policies.google.com/privacy">Google Privacy Policy</a>.
      </p>

      <h2 className="text-xl font-semibold">Your AI assistant and other services</h2>
      <p>
        Data returned to your assistant (for example ChatGPT or Claude) is then handled under that provider&rsquo;s own
        terms and privacy policy. Choose an assistant and plan you are comfortable sharing your analytics with. We use
        hosting, database and email providers to run the service; they process data only on our behalf.
      </p>

      <h2 className="text-xl font-semibold">Sharing</h2>
      <p>
        We do not share personal data with third parties except these service providers, to comply with the law, or to
        protect the service from abuse. Humans at {b.name} do not read your Google data; it is accessed only by
        automated requests you trigger, apart from limited troubleshooting you ask for.
      </p>

      <h2 className="text-xl font-semibold">Security</h2>
      <p>
        Refresh tokens are encrypted at rest, our own access tokens are stored only as one-way hashes, connections use
        HTTPS, and access is limited to what is needed to run the service. No system is perfectly secure; if we learn of
        a breach affecting you we will tell you.
      </p>

      <h2 className="text-xl font-semibold">Retention and deletion</h2>
      <p>
        You can disconnect Google at any time from your <a className="underline" href="/account">account page</a>. That
        revokes our access with Google, deletes the stored token and ends all assistant sessions. You can also choose{" "}
        <em>Delete my data</em> there to remove your account record. You can revoke access from Google directly at{" "}
        <a className="underline" href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a> (this also covers YouTube access).
        Usage records (time, tool, property or site identifier, success, response time, row count) are kept for 90 days and then deleted. A short log of administrative and sign-in events is kept for up to 12 months. When you choose <em>Delete my data</em>, your account, tokens, the log entries about you and any pre-approval for your email are deleted immediately; usage records are detached from you and removed within 90 days. To prevent repeated free trials and lifted suspensions, we keep for 12 months a one-way hash of your Google account identifier together with your plan status (no email or name).
      </p>

      <h2 className="text-xl font-semibold">Contact</h2>
      <p>
        {b.supportEmail ? (
          <>
            Questions or requests: <a className="underline" href={`mailto:${b.supportEmail}`}>{b.supportEmail}</a>.
          </>
        ) : (
          "Contact the operator of this service using the details on the home page."
        )}{" "}
        We may update this policy; the date above shows the latest version.
      </p>
    </SiteShell>
  );
}
