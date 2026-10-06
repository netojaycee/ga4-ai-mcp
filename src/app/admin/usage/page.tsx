import type { Metadata } from "next";
import { requireAdmin } from "@/server/admin/guard";
import { WINDOWS, loadUsage, parseWindow } from "@/server/admin/queries-usage";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Usage", robots: { index: false, follow: false } };

const pct = (r: number) => `${(r * 100).toFixed(1)}%`;
const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-2 tabular-nums";

export default async function UsagePage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const days = parseWindow((await searchParams).days);
  const v = await loadUsage(days);

  return (
    <main className="mx-auto max-w-5xl space-y-8 p-4 text-zinc-900 dark:text-zinc-100">
      <header className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-2xl font-semibold">Usage</h1>
        <nav aria-label="Time window" className="flex gap-2">
          {WINDOWS.map((w) => (
            <a
              key={w}
              href={`?days=${w}`}
              aria-current={w === days ? "page" : undefined}
              className={`rounded border px-3 py-1 text-sm ${w === days ? "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-400 dark:border-zinc-600"}`}
            >
              {w} days
            </a>
          ))}
        </nav>
      </header>

      <dl className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          ["Calls", v.totals.calls.toLocaleString("en-US")],
          ["Errors", v.totals.errors.toLocaleString("en-US")],
          ["Error rate", pct(v.totals.errorRate)],
        ].map(([k, val]) => (
          <div key={k} className="rounded border border-zinc-300 p-4 dark:border-zinc-700">
            <dt className="text-sm text-zinc-600 dark:text-zinc-400">{k}</dt>
            <dd className="text-2xl font-semibold tabular-nums">{val}</dd>
          </div>
        ))}
      </dl>

      <section aria-labelledby="daily-h" className="space-y-2">
        <h2 id="daily-h" className="text-lg font-medium">
          Calls per day (UTC)
        </h2>
        <div role="img" aria-label={`Stacked bars of successful and failed calls per day over the last ${days} days. Data table below.`} className="flex h-40 items-end gap-1">
          {v.daily.map((d) => (
            <div key={d.day} className="flex h-full min-w-0 flex-1 flex-col justify-end" title={`${d.day}: ${d.ok} ok, ${d.err} errors`}>
              <div className="bg-red-600" style={{ height: `${(d.err / v.maxDaily) * 100}%` }} />
              <div className="bg-emerald-600" style={{ height: `${(d.ok / v.maxDaily) * 100}%` }} />
            </div>
          ))}
        </div>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          <span className="inline-block h-2 w-2 bg-emerald-600" /> ok <span className="ml-3 inline-block h-2 w-2 bg-red-600" /> error. Peak day: {v.maxDaily.toLocaleString("en-US")} calls.
        </p>
        <details className="overflow-x-auto">
          <summary className="cursor-pointer text-sm">Data table</summary>
          <table className="mt-2 w-full text-sm">
            <caption className="sr-only">Calls per day</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Day</th>
                <th scope="col" className={th}>OK</th>
                <th scope="col" className={th}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {v.daily.map((d) => (
                <tr key={d.day} className="border-t border-zinc-200 dark:border-zinc-800">
                  <th scope="row" className={`${th} font-normal`}>{d.day}</th>
                  <td className={td}>{d.ok}</td>
                  <td className={td}>{d.err}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      </section>

      <section aria-labelledby="tools-h" className="space-y-2 overflow-x-auto">
        <h2 id="tools-h" className="text-lg font-medium">By tool</h2>
        <table className="w-full text-sm">
          <caption className="sr-only">Calls, error rate and latency per tool</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>Tool</th>
              <th scope="col" className={th}>Calls</th>
              <th scope="col" className={th}>Error rate</th>
              <th scope="col" className={th}>p50 ms</th>
              <th scope="col" className={th}>p95 ms</th>
            </tr>
          </thead>
          <tbody>
            {v.tools.map((t) => (
              <tr key={t.tool} className="border-t border-zinc-200 dark:border-zinc-800">
                <th scope="row" className={`${th} font-mono font-normal`}>{t.tool}</th>
                <td className={td}>{t.calls}</td>
                <td className={td}>{pct(t.errorRate)}</td>
                <td className={td}>{t.p50 ?? "n/a"}</td>
                <td className={td}>{t.p95 ?? "n/a"}</td>
              </tr>
            ))}
            {v.tools.length === 0 && (
              <tr><td colSpan={5} className={td}>No calls in this window.</td></tr>
            )}
          </tbody>
        </table>
      </section>

      <div className="grid gap-8 md:grid-cols-2">
        <section aria-labelledby="users-h" className="space-y-2 overflow-x-auto">
          <h2 id="users-h" className="text-lg font-medium">Top users</h2>
          <table className="w-full text-sm">
            <caption className="sr-only">Top users by calls</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>User</th>
                <th scope="col" className={th}>Calls</th>
                <th scope="col" className={th}>Errors</th>
              </tr>
            </thead>
            <tbody>
              {v.topUsers.map((u) => (
                <tr key={u.email} className="border-t border-zinc-200 dark:border-zinc-800">
                  <th scope="row" className={`${th} font-normal`}>{u.email}</th>
                  <td className={td}>{u.calls}</td>
                  <td className={td}>{u.errors}</td>
                </tr>
              ))}
              {v.topUsers.length === 0 && (
                <tr><td colSpan={3} className={td}>No calls in this window.</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="errors-h" className="space-y-2 overflow-x-auto">
          <h2 id="errors-h" className="text-lg font-medium">Top error codes</h2>
          <table className="w-full text-sm">
            <caption className="sr-only">Most frequent error codes</caption>
            <thead>
              <tr>
                <th scope="col" className={th}>Code</th>
                <th scope="col" className={th}>Count</th>
              </tr>
            </thead>
            <tbody>
              {v.errorCodes.map((e) => (
                <tr key={e.code} className="border-t border-zinc-200 dark:border-zinc-800">
                  <th scope="row" className={`${th} font-mono font-normal`}>{e.code}</th>
                  <td className={td}>{e.count}</td>
                </tr>
              ))}
              {v.errorCodes.length === 0 && (
                <tr><td colSpan={2} className={td}>No errors in this window.</td></tr>
              )}
            </tbody>
          </table>
        </section>
      </div>
    </main>
  );
}
