import Link from "next/link";
import { PLANS } from "@/config/plans";
import { requireAdmin } from "@/server/admin/guard";
import { drizzleAdminUsersRepo } from "@/server/admin/repos";
import { DEFAULT_KILL_MESSAGE, getKillSwitch, type KillSwitchState } from "@/server/admin/settings";
import { daysLeft, parseListParams } from "@/server/admin/users";
import { killSwitchAction } from "./actions";
import { fmtDate, fmtDateTime, ui } from "./_components/ui";

export const dynamic = "force-dynamic";

type SP = Promise<{ q?: string; plan?: string; page?: string; msg?: string; err?: string }>;

export default async function AdminUsersPage({ searchParams }: { searchParams: SP }) {
  await requireAdmin();
  const sp = await searchParams;
  const params = parseListParams(sp);
  const now = new Date();

  const [{ rows, total }, ks] = await Promise.all([
    drizzleAdminUsersRepo(() => now).list(params),
    getKillSwitch().catch((): KillSwitchState | null => null),
  ]);
  const pages = Math.max(1, Math.ceil(total / params.pageSize));
  const href = (page: number) => {
    const u = new URLSearchParams();
    if (params.q) u.set("q", params.q);
    if (params.plan) u.set("plan", params.plan);
    if (page > 1) u.set("page", String(page));
    const s = u.toString();
    return s ? `/admin?${s}` : "/admin";
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Users</h1>
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

      {ks?.active && (
        <div role="alert" className="rounded border-2 border-red-700 bg-red-50 p-3 text-red-900 dark:bg-red-950 dark:text-red-100">
          <strong>Kill switch is ON.</strong> Every tool call is being refused with: “{ks.message ?? DEFAULT_KILL_MESSAGE}”
        </div>
      )}
      <section aria-labelledby="ks-h" className={ui.card}>
        <h2 id="ks-h" className="mb-2 text-lg font-semibold">
          Global kill switch
        </h2>
        <p className={`mb-3 text-sm ${ui.muted}`}>
          Pauses every tool call for every user (takes effect within about 10 seconds). Users see the message below.
        </p>
        <form action={killSwitchAction} className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1 text-sm">
            Message (optional)
            <input name="message" maxLength={500} defaultValue={ks?.message ?? ""} placeholder={DEFAULT_KILL_MESSAGE} className={`${ui.input} w-80 max-w-full`} />
          </label>
          {ks?.active ? (
            <button name="active" value="off" className={ui.button}>
              Turn kill switch off
            </button>
          ) : (
            <button name="active" value="on" className={ui.danger}>
              Turn kill switch on
            </button>
          )}
        </form>
      </section>

      <form method="get" action="/admin" role="search" className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm">
          Search email
          <input type="search" name="q" defaultValue={params.q} className={`${ui.input} w-64 max-w-full`} />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Plan
          <select name="plan" defaultValue={params.plan ?? ""} className={ui.input}>
            <option value="">All plans</option>
            {PLANS.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
        <button type="submit" className={ui.button}>
          Filter
        </button>
        {(params.q || params.plan) && (
          <Link href="/admin" className={`${ui.link} text-sm`}>
            Clear
          </Link>
        )}
      </form>

      <p className={`text-sm ${ui.muted}`} aria-live="polite">
        {total} user{total === 1 ? "" : "s"} · page {Math.min(params.page, pages)} of {pages}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[56rem] border-collapse text-sm">
          <caption className="sr-only">Users</caption>
          <thead className="border-b border-neutral-400 dark:border-neutral-600">
            <tr>
              <th scope="col" className={ui.th}>Email</th>
              <th scope="col" className={ui.th}>Plan</th>
              <th scope="col" className={ui.th}>Trial end</th>
              <th scope="col" className={ui.th}>Google</th>
              <th scope="col" className={ui.th}>Last seen</th>
              <th scope="col" className={`${ui.th} text-right`}>Calls (7d)</th>
              <th scope="col" className={ui.th}>Created</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-200 dark:divide-neutral-800">
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className={`${ui.td} ${ui.muted}`}>
                  No users match.
                </td>
              </tr>
            )}
            {rows.map((u) => {
              const left = daysLeft(u.trialEndsAt, now);
              return (
                <tr key={u.id}>
                  <th scope="row" className={`${ui.td} text-left font-normal`}>
                    <Link href={`/admin/users/${u.id}`} className={ui.link}>
                      {u.email}
                    </Link>
                  </th>
                  <td className={ui.td}>{u.plan}</td>
                  <td className={ui.td}>
                    {fmtDate(u.trialEndsAt)}
                    {left !== null && <span className={ui.muted}> ({left >= 0 ? `${left}d left` : "ended"})</span>}
                  </td>
                  <td className={ui.td}>{u.connectionStatus ?? "not connected"}</td>
                  <td className={ui.td}>{fmtDateTime(u.lastSeenAt)}</td>
                  <td className={`${ui.td} text-right tabular-nums`}>{u.calls7d}</td>
                  <td className={ui.td}>{fmtDate(u.createdAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <nav aria-label="Pagination" className="flex gap-4 text-sm">
        {params.page > 1 && (
          <Link href={href(params.page - 1)} className={ui.link} rel="prev">
            Previous
          </Link>
        )}
        {params.page < pages && (
          <Link href={href(params.page + 1)} className={ui.link} rel="next">
            Next
          </Link>
        )}
      </nav>
    </div>
  );
}
