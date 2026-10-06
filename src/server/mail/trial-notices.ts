import { and, eq, gt, inArray, lte } from "drizzle-orm";
import { createHash, timingSafeEqual } from "node:crypto";
import { brand } from "@/config/brand";
import { db } from "@/server/db/client";
import { auditLog, users } from "@/server/db/schema";
import { sendEmail, type EmailMessage, type SendResult } from "./resend";
import { trialEndedEmail, trialEndingEmail, type MailBrand } from "./templates";

export const NOTICE_ACTION = "cron.trial_notice_sent";
export const ENDING_WINDOW_MS = 3 * 86_400_000;
export const ENDED_WINDOW_MS = 7 * 86_400_000;
export const BATCH_SIZE = 10;
export const MAX_PER_RUN = 200;

export type NoticeKind = "ending_soon" | "ended";

export interface TrialUser {
  id: string;
  email: string;
  trialEndsAt: Date;
}

export type CronAuth = "ok" | "unconfigured" | "unauthorized";

/** Constant-time bearer check; an unset secret never authorizes anything. */
export function checkCronAuth(authorization: string | null, secret: string | undefined): CronAuth {
  if (!secret) return "unconfigured";
  const m = /^Bearer (.+)$/.exec(authorization ?? "");
  if (!m) return "unauthorized";
  const a = createHash("sha256").update(m[1]).digest();
  const b = createHash("sha256").update(secret).digest();
  return timingSafeEqual(a, b) ? "ok" : "unauthorized";
}

export function classifyTrialUsers(rows: TrialUser[], now: Date): { user: TrialUser; kind: NoticeKind }[] {
  const t = now.getTime();
  const out: { user: TrialUser; kind: NoticeKind }[] = [];
  for (const user of rows) {
    const end = user.trialEndsAt.getTime();
    if (end > t && end <= t + ENDING_WINDOW_MS) out.push({ user, kind: "ending_soon" });
    else if (end <= t && end > t - ENDED_WINDOW_MS) out.push({ user, kind: "ended" });
  }
  return out;
}

export interface NoticeDeps {
  now(): Date;
  /** Users on plan `trial` whose trial_ends_at is in (from, to]. */
  listTrialUsers(from: Date, to: Date): Promise<TrialUser[]>;
  /** Keys "userId:kind" already recorded in the audit log. */
  alreadySent(userIds: string[]): Promise<Set<string>>;
  recordSent(userId: string, kind: NoticeKind): Promise<void>;
  send(message: EmailMessage): Promise<SendResult>;
  brand: MailBrand;
}

export interface KindSummary {
  sent: number;
  skipped: number;
  failed: number;
}

export interface NoticeSummary {
  ending_soon: KindSummary;
  ended: KindSummary;
  stoppedEarly: boolean;
  stopReason: string | null;
}

export async function runTrialNotices(deps: NoticeDeps): Promise<NoticeSummary> {
  const now = deps.now();
  const summary: NoticeSummary = {
    ending_soon: { sent: 0, skipped: 0, failed: 0 },
    ended: { sent: 0, skipped: 0, failed: 0 },
    stoppedEarly: false,
    stopReason: null,
  };
  const candidates = classifyTrialUsers(
    await deps.listTrialUsers(new Date(now.getTime() - ENDED_WINDOW_MS), new Date(now.getTime() + ENDING_WINDOW_MS)),
    now,
  );
  if (candidates.length === 0) return summary;

  const done = await deps.alreadySent(candidates.map((c) => c.user.id));
  const todo: typeof candidates = [];
  for (const c of candidates) {
    if (done.has(`${c.user.id}:${c.kind}`)) summary[c.kind].skipped++;
    else todo.push(c);
  }

  const templates = { ending_soon: trialEndingEmail(deps.brand), ended: trialEndedEmail(deps.brand) };
  const work = todo.slice(0, MAX_PER_RUN);
  for (let i = 0; i < work.length && !summary.stoppedEarly; i += BATCH_SIZE) {
    const batch = work.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((c) => deps.send({ to: c.user.email, ...templates[c.kind] })));
    for (let j = 0; j < batch.length; j++) {
      const { user, kind } = batch[j];
      const res = results[j];
      if (res.ok) {
        // If recording fails the next run may resend; surface that rather than hide it.
        await deps.recordSent(user.id, kind);
        summary[kind].sent++;
      } else {
        summary[kind].failed++;
        if (res.reason === "rate_limited" || res.reason === "not_configured") {
          summary.stoppedEarly = true;
          summary.stopReason = res.reason;
        }
      }
    }
  }
  return summary;
}

export function drizzleNoticeDeps(): NoticeDeps {
  return {
    now: () => new Date(),
    brand: brand(),
    send: sendEmail,
    async listTrialUsers(from, to) {
      const rows = await db()
        .select({ id: users.id, email: users.email, trialEndsAt: users.trialEndsAt })
        .from(users)
        .where(and(eq(users.plan, "trial"), gt(users.trialEndsAt, from), lte(users.trialEndsAt, to)));
      return rows.flatMap((r) => (r.trialEndsAt ? [{ id: r.id, email: r.email, trialEndsAt: r.trialEndsAt }] : []));
    },
    async alreadySent(userIds) {
      const out = new Set<string>();
      for (let i = 0; i < userIds.length; i += 500) {
        const rows = await db()
          .select({ target: auditLog.target, meta: auditLog.meta })
          .from(auditLog)
          .where(and(eq(auditLog.action, NOTICE_ACTION), inArray(auditLog.target, userIds.slice(i, i + 500))));
        for (const r of rows) {
          const kind = (r.meta as { kind?: unknown } | null)?.kind;
          if (r.target && typeof kind === "string") out.add(`${r.target}:${kind}`);
        }
      }
      return out;
    },
    async recordSent(userId, kind) {
      await db().insert(auditLog).values({ actor: "cron", action: NOTICE_ACTION, target: userId, meta: { kind } });
    },
  };
}
