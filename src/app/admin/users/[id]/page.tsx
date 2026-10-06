import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";
import { PLANS } from "@/config/plans";
import { requireAdmin } from "@/server/admin/guard";
import { drizzleAdminUsersRepo } from "@/server/admin/repos";
import { daysLeft } from "@/server/admin/users";
import { fmtDate, fmtDateTime, ui } from "../../_components/ui";
import {
  disconnectGoogleAction,
  revokeSessionsAction,
  suspendAction,
  unsuspendAction,
  updateNotesAction,
  updatePlanAction,
  updateTrialAction,
} from "./actions";

export const dynamic = "force-dynamic";

type Props = { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string; err?: string }> };

function Confirm({ id }: { id: string }) {
  return (
    <label className="flex items-center gap-2 text-sm">
      <input type="checkbox" name="confirm" value="yes" required id={`confirm-${id}`} />I understand and want to do this
    </label>
  );
}

export default async function AdminUserPage({ params, searchParams }: Props) {
  await requireAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const sp = await searchParams;
  const now = new Date();
  const u = await drizzleAdminUsersRepo(() => now).get(id);
  if (!u) notFound();
  const left = daysLeft(u.trialEndsAt, now);
  const suspended = u.plan === "suspended";

  return (
    <div className="space-y-6">
      <p>
        <Link href="/admin" className={`${ui.link} text-sm`}>
          ← All users
        </Link>
      </p>
      <h1 className="text-2xl font-semibold">{u.email}</h1>
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

      <dl className={`grid grid-cols-[max-content_1fr] gap-x-6 gap-y-1 text-sm ${ui.card}`}>
        <dt className={ui.muted}>Name</dt>
        <dd>{u.name ?? "–"}</dd>
        <dt className={ui.muted}>Plan</dt>
        <dd>{u.plan}</dd>
        <dt className={ui.muted}>Trial end</dt>
        <dd>
          {fmtDate(u.trialEndsAt)}
          {left !== null && ` (${left >= 0 ? `${left} days left` : "ended"})`}
        </dd>
        <dt className={ui.muted}>Google</dt>
        <dd>{u.connectionStatus ? `${u.connectionStatus}${u.googleEmail ? ` (${u.googleEmail})` : ""}` : "not connected"}</dd>
        <dt className={ui.muted}>Last seen</dt>
        <dd>{fmtDateTime(u.lastSeenAt)}</dd>
        <dt className={ui.muted}>Calls (7 days)</dt>
        <dd>{u.calls7d}</dd>
        <dt className={ui.muted}>Created</dt>
        <dd>{fmtDate(u.createdAt)}</dd>
      </dl>

      <section aria-labelledby="plan-h" className={ui.card}>
        <h2 id="plan-h" className="mb-2 text-lg font-semibold">Plan</h2>
        <form action={updatePlanAction} className="flex flex-wrap items-end gap-3">
          <input type="hidden" name="userId" value={u.id} />
          <label className="flex flex-col gap-1 text-sm">
            Plan
            <select name="plan" defaultValue={u.plan} className={ui.input}>
              {PLANS.map((p) => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </label>
          <button type="submit" className={ui.button}>Save plan</button>
        </form>
      </section>

      <section aria-labelledby="trial-h" className={ui.card}>
        <h2 id="trial-h" className="mb-2 text-lg font-semibold">Trial end</h2>
        <div className="flex flex-wrap gap-6">
          <form action={updateTrialAction} className="flex items-end gap-2">
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="mode" value="extend" />
            <label className="flex flex-col gap-1 text-sm">
              Extend by (days)
              <input type="number" name="days" min={1} max={365} defaultValue={7} required className={`${ui.input} w-24`} />
            </label>
            <button type="submit" className={ui.button}>Extend</button>
          </form>
          <form action={updateTrialAction} className="flex items-end gap-2">
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="mode" value="set" />
            <label className="flex flex-col gap-1 text-sm">
              Set end date
              <input type="date" name="date" required defaultValue={u.trialEndsAt ? fmtDate(u.trialEndsAt) : undefined} className={ui.input} />
            </label>
            <button type="submit" className={ui.button}>Set date</button>
          </form>
          <form action={updateTrialAction} className="flex items-end">
            <input type="hidden" name="userId" value={u.id} />
            <input type="hidden" name="mode" value="clear" />
            <button type="submit" className={ui.button}>Clear (open-ended)</button>
          </form>
        </div>
      </section>

      <section aria-labelledby="notes-h" className={ui.card}>
        <h2 id="notes-h" className="mb-2 text-lg font-semibold">Notes</h2>
        <form action={updateNotesAction} className="space-y-2">
          <input type="hidden" name="userId" value={u.id} />
          <label className="flex flex-col gap-1 text-sm">
            Internal notes (never shown to the user)
            <textarea name="notes" rows={4} maxLength={2000} defaultValue={u.notes ?? ""} className={`${ui.input} w-full`} />
          </label>
          <button type="submit" className={ui.button}>Save notes</button>
        </form>
      </section>

      <section aria-labelledby="danger-h" className={`${ui.card} space-y-5 border-red-700`}>
        <h2 id="danger-h" className="text-lg font-semibold">Access controls</h2>

        <form action={revokeSessionsAction} className="space-y-2">
          <input type="hidden" name="userId" value={u.id} />
          <h3 className="font-medium">Revoke sessions</h3>
          <p className={`text-sm ${ui.muted}`}>Signs the user&apos;s AI clients out. They can reconnect.</p>
          <Confirm id="revoke" />
          <button type="submit" className={ui.danger}>Revoke sessions</button>
        </form>

        <form action={disconnectGoogleAction} className="space-y-2">
          <input type="hidden" name="userId" value={u.id} />
          <h3 className="font-medium">Disconnect Google</h3>
          <p className={`text-sm ${ui.muted}`}>Revokes at Google (best effort), deletes the stored token and revokes sessions.</p>
          <Confirm id="disconnect" />
          <button type="submit" className={ui.danger} disabled={!u.connectionStatus}>Disconnect Google</button>
        </form>

        {suspended ? (
          <form action={unsuspendAction} className="space-y-2">
            <input type="hidden" name="userId" value={u.id} />
            <h3 className="font-medium">Unsuspend</h3>
            <p className={`text-sm ${ui.muted}`}>Restores the plan the user had before suspension (or trial if unknown).</p>
            <button type="submit" className={ui.button}>Unsuspend</button>
          </form>
        ) : (
          <form action={suspendAction} className="space-y-2">
            <input type="hidden" name="userId" value={u.id} />
            <h3 className="font-medium">Suspend</h3>
            <p className={`text-sm ${ui.muted}`}>Blocks all calls and revokes sessions. The previous plan is remembered for unsuspending.</p>
            <Confirm id="suspend" />
            <button type="submit" className={ui.danger}>Suspend user</button>
          </form>
        )}
      </section>
    </div>
  );
}
