import type { Metadata } from "next";
import { requireAdmin } from "@/server/admin/guard";
import { formatMeta, loadAudit, parseAuditFilter } from "@/server/admin/queries-audit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Audit log", robots: { index: false, follow: false } };

const th = "px-3 py-2 text-left font-medium";
const td = "px-3 py-2 align-top";

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireAdmin();
  const filter = parseAuditFilter(await searchParams);
  const { rows, hasNext, page } = await loadAudit(filter);
  const link = (p: number) => {
    const q = new URLSearchParams();
    if (filter.prefix) q.set("prefix", filter.prefix);
    if (filter.actor) q.set("actor", filter.actor);
    q.set("page", String(p));
    return `?${q.toString()}`;
  };

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-4 text-zinc-900 dark:text-zinc-100">
      <h1 className="text-2xl font-semibold">Audit log</h1>
      <form method="get" className="flex flex-wrap items-end gap-3">
        <label className="text-sm">
          <span className="block">Action prefix</span>
          <input name="prefix" defaultValue={filter.prefix} placeholder="admin." className="rounded border border-zinc-400 bg-transparent px-2 py-1 dark:border-zinc-600" />
        </label>
        <label className="text-sm">
          <span className="block">Actor contains</span>
          <input name="actor" defaultValue={filter.actor} placeholder="name@example.com" className="rounded border border-zinc-400 bg-transparent px-2 py-1 dark:border-zinc-600" />
        </label>
        <button type="submit" className="rounded border border-zinc-400 px-3 py-1 text-sm dark:border-zinc-600">Filter</button>
        <a href="?" className="text-sm underline">Reset</a>
      </form>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">Audit log, newest first, page {page}</caption>
          <thead>
            <tr>
              <th scope="col" className={th}>Time (UTC)</th>
              <th scope="col" className={th}>Actor</th>
              <th scope="col" className={th}>Action</th>
              <th scope="col" className={th}>Target</th>
              <th scope="col" className={th}>Meta</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const meta = formatMeta(r.meta);
              return (
                <tr key={r.id} className="border-t border-zinc-200 dark:border-zinc-800">
                  <td className={`${td} whitespace-nowrap tabular-nums`}>{r.createdAt.toISOString().replace("T", " ").slice(0, 19)}</td>
                  <td className={td}>{r.actor}</td>
                  <td className={`${td} font-mono`}>{r.action}</td>
                  <td className={`${td} break-all`}>{r.target ?? ""}</td>
                  <td className={td}>
                    {meta && (
                      <details>
                        <summary className="cursor-pointer">View</summary>
                        <pre className="mt-1 max-w-md overflow-x-auto whitespace-pre-wrap break-words rounded bg-zinc-100 p-2 text-xs dark:bg-zinc-900">{meta}</pre>
                      </details>
                    )}
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr><td colSpan={5} className={td}>No entries.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <nav aria-label="Pagination" className="flex gap-4 text-sm">
        {page > 1 ? <a href={link(page - 1)} rel="prev" className="underline">Newer</a> : <span aria-hidden="true" className="text-zinc-500">Newer</span>}
        <span>Page {page}</span>
        {hasNext ? <a href={link(page + 1)} rel="next" className="underline">Older</a> : <span aria-hidden="true" className="text-zinc-500">Older</span>}
      </nav>
    </main>
  );
}
