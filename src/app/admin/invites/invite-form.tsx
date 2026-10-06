"use client";

import { useActionState } from "react";
import { sendInvitesAction, type InviteState } from "./actions";

const field = "w-full rounded border border-zinc-400 bg-transparent px-2 py-1 dark:border-zinc-600";

export function InviteForm({ maxRecipients, maxNote }: { maxRecipients: number; maxNote: number }) {
  const [state, action, pending] = useActionState<InviteState, FormData>(sendInvitesAction, null);
  return (
    <>
      <form action={action} className="space-y-4">
        <label className="block text-sm">
          <span className="mb-1 block">Email addresses (comma or newline separated, up to {maxRecipients})</span>
          <textarea name="emails" required rows={5} className={field} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block">Personal note (optional, up to {maxNote} characters)</span>
          <textarea name="note" rows={4} maxLength={maxNote} className={field} />
        </label>
        <button type="submit" disabled={pending} className="rounded bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900">
          {pending ? "Sending..." : "Send invites"}
        </button>
      </form>
      <div role="status" aria-live="polite" className="mt-6">
        {state && !state.ok && <p className="text-red-700 dark:text-red-400">{state.error}</p>}
        {state?.ok && (
          <section aria-labelledby="res-h" className="space-y-2">
            <h2 id="res-h" className="text-lg font-medium">Results</h2>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Recipient</th>
                  <th scope="col" className="px-3 py-2 text-left font-medium">Result</th>
                </tr>
              </thead>
              <tbody>
                {state.results.map((r) => (
                  <tr key={r.email} className="border-t border-zinc-200 dark:border-zinc-800">
                    <td className="px-3 py-2 break-all">{r.email}</td>
                    <td className="px-3 py-2">{r.status}: {r.detail}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {state.invalid.length > 0 && <p>Ignored invalid entries: {state.invalid.join(", ")}</p>}
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Invites left this hour: {state.remainingThisHour}</p>
          </section>
        )}
      </div>
    </>
  );
}
