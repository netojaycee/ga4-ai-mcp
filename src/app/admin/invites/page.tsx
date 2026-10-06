import type { Metadata } from "next";
import { requireAdmin } from "@/server/admin/guard";
import { MAX_NOTE_LENGTH, MAX_RECIPIENTS_PER_SEND } from "@/server/mail/invites";
import { InviteForm } from "./invite-form";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Invites", robots: { index: false, follow: false } };

export default async function InvitesPage() {
  await requireAdmin();
  return (
    <main className="mx-auto max-w-2xl space-y-6 p-4 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-2xl font-semibold">Invite by email</h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Sends the invite email with the connector URL and setup steps. Each send is recorded in the audit log (result only, not the message).
      </p>
      <InviteForm maxRecipients={MAX_RECIPIENTS_PER_SEND} maxNote={MAX_NOTE_LENGTH} />
    </main>
  );
}
