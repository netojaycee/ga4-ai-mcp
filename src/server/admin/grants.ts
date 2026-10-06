import { z } from "zod";
import { PLANS, type Plan } from "@/config/plans";
import type { AuditFn } from "./users";

export const MAX_GRANT_EMAILS = 200;
const emailSchema = z.email();

export interface ParsedEmails {
  valid: string[];
  invalid: string[];
  duplicates: number;
}

/** Splits on commas, semicolons, whitespace and newlines; lower-cases; de-duplicates. */
export function parseEmailList(raw: string): ParsedEmails {
  const seen = new Set<string>();
  const valid: string[] = [];
  const invalid: string[] = [];
  let duplicates = 0;
  for (const tok of raw
    .split(/[\s,;]+/)
    .map((t) => t.trim().replace(/^<|>$/g, "").toLowerCase())
    .filter(Boolean)) {
    if (seen.has(tok)) {
      duplicates++;
      continue;
    }
    seen.add(tok);
    (emailSchema.safeParse(tok).success && tok.length <= 254 ? valid : invalid).push(tok);
  }
  return { valid, invalid, duplicates };
}

export interface GrantRow {
  email: string;
  plan: Plan;
  note: string | null;
  createdBy: string;
  createdAt: Date;
  appliedAt: Date | null;
}

export interface GrantsRepo {
  /** Existing users by lower-cased email: id and current plan. */
  findUsersByEmails(emails: string[]): Promise<{ id: string; email: string; plan: Plan }[]>;
  setUserPlan(userId: string, plan: Plan): Promise<void>;
  /** Insert or replace a pending grant. */
  upsertGrant(g: { email: string; plan: Plan; note: string | null; createdBy: string }): Promise<void>;
  list(): Promise<GrantRow[]>;
  /** Deletes only unapplied grants. Returns whether a row was deleted. */
  deletePending(email: string): Promise<boolean>;
}

export interface GrantResult {
  updated: string[];
  alreadyOnPlan: string[];
  pending: string[];
  invalid: string[];
  duplicates: number;
}

export class GrantInputError extends Error {}

const inputSchema = z.object({
  emails: z.string().min(1, "Paste at least one email address."),
  plan: z.enum(PLANS),
  note: z
    .string()
    .max(500)
    .optional()
    .transform((s) => s?.trim() || null),
});

export async function applyGrants(
  d: { repo: GrantsRepo; audit: AuditFn },
  actor: string,
  input: { emails: unknown; plan: unknown; note: unknown },
): Promise<GrantResult> {
  const parsed = inputSchema.safeParse({ emails: input.emails, plan: input.plan, note: input.note ?? undefined });
  if (!parsed.success) throw new GrantInputError(parsed.error.issues[0]?.message ?? "Invalid input.");
  const { valid, invalid, duplicates } = parseEmailList(parsed.data.emails);
  if (valid.length + invalid.length > MAX_GRANT_EMAILS) {
    throw new GrantInputError(`At most ${MAX_GRANT_EMAILS} email addresses at a time.`);
  }
  if (valid.length === 0) throw new GrantInputError("No valid email addresses found.");
  const { plan, note } = parsed.data;

  const existing = new Map((await d.repo.findUsersByEmails(valid)).map((u) => [u.email.toLowerCase(), u]));
  const result: GrantResult = { updated: [], alreadyOnPlan: [], pending: [], invalid, duplicates };
  for (const email of valid) {
    const u = existing.get(email);
    if (u) {
      if (u.plan === plan) {
        result.alreadyOnPlan.push(email);
        continue;
      }
      const before = u.plan;
      await d.repo.setUserPlan(u.id, plan);
      await d.audit({
        actor,
        action: "admin.user.plan_changed",
        target: u.id,
        meta: { before, after: plan, via: "team_grant", note },
      });
      result.updated.push(email);
    } else {
      await d.repo.upsertGrant({ email, plan, note, createdBy: actor });
      await d.audit({ actor, action: "admin.grant.created", target: email, meta: { plan, note } });
      result.pending.push(email);
    }
  }
  return result;
}

export async function revokeGrant(d: { repo: GrantsRepo; audit: AuditFn }, actor: string, rawEmail: unknown) {
  const email = emailSchema.safeParse(String(rawEmail ?? "").trim().toLowerCase());
  if (!email.success) throw new GrantInputError("Invalid email address.");
  const deleted = await d.repo.deletePending(email.data);
  if (!deleted) throw new GrantInputError("No pending grant for that address.");
  await d.audit({ actor, action: "admin.grant.revoked", target: email.data });
}
