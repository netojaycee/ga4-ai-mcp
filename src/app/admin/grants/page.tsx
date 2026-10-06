import { PLANS } from "@/config/plans";
import { MAX_GRANT_EMAILS } from "@/server/admin/grants";
import { requireAdmin } from "@/server/admin/guard";
import { drizzleGrantsRepo } from "@/server/admin/repos";
import { fmtDateTime, ui } from "../_components/ui";
import { applyGrantsAction, revokeGrantAction } from "./actions";

export const dynamic = "force-dynamic";

export default async function GrantsPage({ searchParams }: { searchParams: Promise<{ msg?: string; err?: string }> }) {
  await requireAdmin();
  const sp = await searchParams;
  const grants = await drizzleGrantsRepo().list();
  const pending = grants.filter((g) => !g.appliedAt);
  const applied = grants.filter((g) => g.appliedAt);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Team access</h1>
      {sp.msg && (
        <p role="status" className={ui.notice}>
          {sp.msg}
        </p>
      )}
      {sp.err && (
        <p role="alert" className={ui.error}>
          {sp.err}
        </p>
      )}

      <section aria-labelledby="add-h" className={ui.card}>
        <h2 id="add-h" className="mb-1 text-lg font-semibold">Grant a plan</h2>
        <p className={`mb-3 text-sm ${ui.muted}`}>
          Existing users get the plan immediately. Anyone who has not signed in yet is pre-approved and gets the plan (no trial end for internal) on their first sign-in.
        </p>
        <form action={applyGrantsAction} className="space-y-3">
          <label className="flex flex-col gap-1 text-sm">
            Email addresses (comma or one per line, max {MAX_GRANT_EMAILS})
            <textarea name="emails" rows={6} required className={`${ui.input} w-full font-mono`} />
          </label>
          <div className="flex flex-wrap gap-3">
            <label className="flex flex-col gap-1 text-sm">
              Plan
              <select name="plan" defaultValue="internal" className={ui.input}>
                {PLANS.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Note (optional)
              <input name="note" maxLength={500} className={`${ui.input} w-80 max-w-full`} />
            </label>
          </div>
          <button type="submit" className={ui.button}>Apply</button>
        </form>
      </section>

      <section aria-labelledby="pending-h">
        <h2 id="pending-h" className="mb-2 text-lg font-semibold">Pending ({pending.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">Pending grants</caption>
            <thead className="border-b border-neutral-400 dark:border-neutral-600">
              <tr>
                <th scope="col" className={ui.th}>Email</th>
                <th scope="col" className={ui.th}>Plan</th>
                <th scope="col" className={ui.th}>Note</th>
                <th scope="col" className={ui.th}>Added by</th>
                <th scope="col" className={ui.th}>Added</th>
                <th scope="col" className={ui.th}><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {pending.length === 0 && (
                <tr><td colSpan={6} className={`${ui.td} ${ui.muted}`}>No pending grants.</td></tr>
              )}
              {pending.map((g) => (
                <tr key={g.email}>
                  <th scope="row" className={`${ui.td} text-left font-normal`}>{g.email}</th>
                  <td className={ui.td}>{g.plan}</td>
                  <td className={ui.td}>{g.note ?? "–"}</td>
                  <td className={ui.td}>{g.createdBy}</td>
                  <td className={ui.td}>{fmtDateTime(g.createdAt)}</td>
                  <td className={ui.td}>
                    <form action={revokeGrantAction}>
                      <input type="hidden" name="email" value={g.email} />
                      <button type="submit" className={ui.danger} aria-label={`Revoke pending grant for ${g.email}`}>Revoke</button>
                    </form>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section aria-labelledby="applied-h">
        <h2 id="applied-h" className="mb-2 text-lg font-semibold">Applied at first sign-in ({applied.length})</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] border-collapse text-sm">
            <caption className="sr-only">Applied grants</caption>
            <thead className="border-b border-neutral-400 dark:border-neutral-600">
              <tr>
                <th scope="col" className={ui.th}>Email</th>
                <th scope="col" className={ui.th}>Plan</th>
                <th scope="col" className={ui.th}>Note</th>
                <th scope="col" className={ui.th}>Added by</th>
                <th scope="col" className={ui.th}>Applied</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
              {applied.length === 0 && (
                <tr><td colSpan={5} className={`${ui.td} ${ui.muted}`}>None yet.</td></tr>
              )}
              {applied.map((g) => (
                <tr key={g.email}>
                  <th scope="row" className={`${ui.td} text-left font-normal`}>{g.email}</th>
                  <td className={ui.td}>{g.plan}</td>
                  <td className={ui.td}>{g.note ?? "–"}</td>
                  <td className={ui.td}>{g.createdBy}</td>
                  <td className={ui.td}>{fmtDateTime(g.appliedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
