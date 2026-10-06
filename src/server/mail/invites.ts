import { and, count, eq, gte } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog } from "@/server/db/schema";
import { brand } from "@/config/brand";
import { sendEmail, type EmailMessage, type SendResult } from "./resend";
import { inviteEmail, type MailBrand } from "./templates";

export const MAX_RECIPIENTS_PER_SEND = 25;
export const MAX_RECIPIENTS_PER_ADMIN_PER_HOUR = 100;
export const MAX_NOTE_LENGTH = 500;
export const INVITE_ACTION = "admin.invite.sent";

const EMAIL_RE = /^[^\s@<>(),;:"]+@[^\s@<>(),;:"]+\.[^\s@<>(),;:"]{2,}$/;

export interface ParsedRecipients {
  valid: string[];
  invalid: string[];
  duplicates: number;
}

export function parseRecipients(raw: string): ParsedRecipients {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const part of raw.split(/[,\n\r;]+/)) {
    const e = part.trim().toLowerCase();
    if (!e) continue;
    if (e.length > 254 || !EMAIL_RE.test(e)) {
      invalid.push(e.slice(0, 80));
      continue;
    }
    if (seen.has(e)) {
      duplicates++;
      continue;
    }
    seen.add(e);
    valid.push(e);
  }
  return { valid, invalid, duplicates };
}

export interface InviteDeps {
  send(message: EmailMessage): Promise<SendResult>;
  /** Invite audit rows written by this admin since `since`. */
  countRecent(actor: string, since: Date): Promise<number>;
  audit(row: { actor: string; action: string; target: string; meta: Record<string, unknown> }): Promise<void>;
  brand: MailBrand;
  now(): Date;
}

export type RecipientOutcome = { email: string; status: "sent" | "failed" | "skipped"; detail: string };

export type InviteOutcome =
  | { ok: false; error: string }
  | { ok: true; results: RecipientOutcome[]; invalid: string[]; remainingThisHour: number };

export async function sendInvites(
  deps: InviteDeps,
  input: { actor: string; recipients: string; note: string },
): Promise<InviteOutcome> {
  const note = input.note.trim();
  if (note.length > MAX_NOTE_LENGTH) return { ok: false, error: `Note is too long (max ${MAX_NOTE_LENGTH} characters).` };
  const parsed = parseRecipients(input.recipients);
  if (parsed.valid.length === 0) {
    return { ok: false, error: parsed.invalid.length ? `No valid email addresses (invalid: ${parsed.invalid.join(", ")}).` : "Enter at least one email address." };
  }
  if (parsed.valid.length > MAX_RECIPIENTS_PER_SEND) {
    return { ok: false, error: `Too many recipients: ${parsed.valid.length} (max ${MAX_RECIPIENTS_PER_SEND} per send).` };
  }

  const since = new Date(deps.now().getTime() - 3_600_000);
  const used = await deps.countRecent(input.actor, since);
  let remaining = Math.max(0, MAX_RECIPIENTS_PER_ADMIN_PER_HOUR - used);
  if (remaining === 0) {
    return { ok: false, error: `Hourly invite limit reached (${MAX_RECIPIENTS_PER_ADMIN_PER_HOUR} per admin per hour). Try again later.` };
  }

  const rendered = inviteEmail(deps.brand, { note: note || undefined });
  const results: RecipientOutcome[] = [];
  let stop: string | null = null;
  for (const email of parsed.valid) {
    if (remaining === 0) {
      results.push({ email, status: "skipped", detail: "hourly limit reached" });
      continue;
    }
    if (stop) {
      results.push({ email, status: "skipped", detail: stop });
      continue;
    }
    const res = await deps.send({ to: email, ...rendered });
    remaining--;
    const detail = res.ok ? "sent" : res.reason;
    results.push({ email, status: res.ok ? "sent" : "failed", detail });
    // Meta carries the result only, never the message body.
    await deps.audit({
      actor: input.actor,
      action: INVITE_ACTION,
      target: email,
      meta: res.ok ? { result: "sent" } : { result: "failed", reason: res.reason, ...(res.status ? { status: res.status } : {}) },
    });
    if (!res.ok && (res.reason === "rate_limited" || res.reason === "not_configured")) stop = `stopped: ${res.reason}`;
  }
  return { ok: true, results, invalid: parsed.invalid, remainingThisHour: remaining };
}

export function drizzleInviteDeps(): InviteDeps {
  return {
    send: sendEmail,
    brand: brand(),
    now: () => new Date(),
    async countRecent(actor, since) {
      const [row] = await db()
        .select({ n: count() })
        .from(auditLog)
        .where(and(eq(auditLog.action, INVITE_ACTION), eq(auditLog.actor, actor), gte(auditLog.createdAt, since)));
      return row?.n ?? 0;
    },
    async audit(row) {
      await db().insert(auditLog).values(row);
    },
  };
}
