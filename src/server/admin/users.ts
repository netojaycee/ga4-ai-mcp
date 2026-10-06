import { z } from "zod";
import { PLANS, type Plan } from "@/config/plans";

export const PAGE_SIZE = 25;
const DAY_MS = 86_400_000;

export class AdminActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AdminActionError";
  }
}

export interface AdminUserRow {
  id: string;
  email: string;
  plan: Plan;
  trialEndsAt: Date | null;
  connectionStatus: "active" | "revoked" | "error" | null;
  lastSeenAt: Date | null;
  calls7d: number;
  createdAt: Date;
}

export interface AdminUserDetail extends AdminUserRow {
  name: string | null;
  notes: string | null;
  googleEmail: string | null;
}

export interface UserListParams {
  q: string;
  plan: Plan | null;
  page: number;
  pageSize: number;
}

export interface UserPatch {
  plan?: Plan;
  trialEndsAt?: Date | null;
  notes?: string | null;
}

export interface AdminUsersRepo {
  list(p: UserListParams): Promise<{ rows: AdminUserRow[]; total: number }>;
  get(id: string): Promise<AdminUserDetail | null>;
  update(id: string, patch: UserPatch): Promise<void>;
  revokeTokens(id: string, now: Date): Promise<number>;
  /** `meta.previousPlan` of the latest `admin.user.suspended` audit row, if any. */
  previousPlanBeforeSuspend(id: string): Promise<Plan | null>;
}

export interface AuditEntry {
  actor: string;
  action: string;
  target?: string;
  meta?: Record<string, unknown>;
}
export type AuditFn = (e: AuditEntry) => Promise<void>;

export interface DisconnectResult {
  googleRevoked: boolean;
  revokedTokens: number;
}

export interface UserActionDeps {
  repo: AdminUsersRepo;
  audit: AuditFn;
  now: () => Date;
  /** Reuses the account disconnect logic (revoke at Google, delete connection, revoke tokens). */
  disconnect: (userId: string, actor: string) => Promise<DisconnectResult>;
}

/** Normalises URL search params into list params. Never trusts the input. */
export function parseListParams(sp: { q?: string | string[]; plan?: string | string[]; page?: string | string[] }): UserListParams {
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  const q = (one(sp.q) ?? "").trim().slice(0, 200);
  const planRaw = one(sp.plan) ?? "";
  const plan = (PLANS as readonly string[]).includes(planRaw) ? (planRaw as Plan) : null;
  const pageNum = Number.parseInt(one(sp.page) ?? "1", 10);
  const page = Number.isFinite(pageNum) && pageNum >= 1 ? Math.min(pageNum, 100_000) : 1;
  return { q, plan, page, pageSize: PAGE_SIZE };
}

export const offsetFor = (p: Pick<UserListParams, "page" | "pageSize">) => (p.page - 1) * p.pageSize;

/** Escapes LIKE wildcards so a search for "100%" or "a_b" is literal. Pair with ESCAPE '\\'. */
export function likePattern(q: string): string {
  return `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

export function daysLeft(trialEndsAt: Date | null, now: Date): number | null {
  if (!trialEndsAt) return null;
  return Math.ceil((trialEndsAt.getTime() - now.getTime()) / DAY_MS);
}

const uuid = z.uuid();
const planSchema = z.enum(PLANS);
const notesSchema = z.string().max(2000).transform((s) => s.trim() || null);
const confirmSchema = z.literal("yes", { error: "Tick the confirmation box to continue." });

export const trialInputSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("extend"), days: z.coerce.number().int().min(1).max(365) }),
  z.object({ mode: z.literal("set"), date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a YYYY-MM-DD date.") }),
  z.object({ mode: z.literal("clear") }),
]);

function fail(e: z.ZodError): never {
  throw new AdminActionError(e.issues[0]?.message ?? "Invalid input.");
}

function parse<S extends z.ZodType>(schema: S, value: unknown): z.output<S> {
  const r = schema.safeParse(value);
  if (!r.success) fail(r.error);
  return r.data;
}

async function loadUser(d: UserActionDeps, rawId: unknown): Promise<AdminUserDetail> {
  const id = parse(uuid, rawId);
  const u = await d.repo.get(id);
  if (!u) throw new AdminActionError("User not found.");
  return u;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export async function changePlan(d: UserActionDeps, actor: string, input: { userId: unknown; plan: unknown }) {
  const plan = parse(planSchema, input.plan);
  const u = await loadUser(d, input.userId);
  if (u.plan === plan) return;
  await d.repo.update(u.id, { plan });
  await d.audit({ actor, action: "admin.user.plan_changed", target: u.id, meta: { before: u.plan, after: plan } });
}

export function computeTrialEnd(
  input: z.output<typeof trialInputSchema>,
  current: Date | null,
  now: Date,
): Date | null {
  if (input.mode === "clear") return null;
  if (input.mode === "set") {
    const t = new Date(`${input.date}T23:59:59.000Z`);
    if (Number.isNaN(t.getTime()) || t.toISOString().slice(0, 10) !== input.date) throw new AdminActionError("That is not a valid date.");
    return t;
  }
  const base = current && current.getTime() > now.getTime() ? current : now;
  return new Date(base.getTime() + input.days * DAY_MS);
}

export async function changeTrial(d: UserActionDeps, actor: string, input: { userId: unknown; trial: unknown }) {
  const trial = parse(trialInputSchema, input.trial);
  const u = await loadUser(d, input.userId);
  const next = computeTrialEnd(trial, u.trialEndsAt, d.now());
  await d.repo.update(u.id, { trialEndsAt: next });
  await d.audit({
    actor,
    action: "admin.user.trial_changed",
    target: u.id,
    meta: { before: iso(u.trialEndsAt), after: iso(next), mode: trial.mode },
  });
}

export async function changeNotes(d: UserActionDeps, actor: string, input: { userId: unknown; notes: unknown }) {
  const notes = parse(notesSchema, input.notes ?? "");
  const u = await loadUser(d, input.userId);
  await d.repo.update(u.id, { notes });
  // Notes can be long: record sizes, not contents, in the audit trail.
  await d.audit({
    actor,
    action: "admin.user.notes_changed",
    target: u.id,
    meta: { beforeLength: u.notes?.length ?? 0, afterLength: notes?.length ?? 0 },
  });
}

export async function revokeSessions(d: UserActionDeps, actor: string, input: { userId: unknown; confirm: unknown }) {
  parse(confirmSchema, input.confirm);
  const u = await loadUser(d, input.userId);
  const revokedTokens = await d.repo.revokeTokens(u.id, d.now());
  await d.audit({ actor, action: "admin.user.sessions_revoked", target: u.id, meta: { revokedTokens } });
  return revokedTokens;
}

export async function disconnectGoogle(d: UserActionDeps, actor: string, input: { userId: unknown; confirm: unknown }) {
  parse(confirmSchema, input.confirm);
  const u = await loadUser(d, input.userId);
  // The shared disconnect logic writes the audit row (action admin.user.google_disconnected, actor = admin).
  return d.disconnect(u.id, actor);
}

export async function suspendUser(d: UserActionDeps, actor: string, input: { userId: unknown; confirm: unknown }) {
  parse(confirmSchema, input.confirm);
  const u = await loadUser(d, input.userId);
  if (u.plan === "suspended") throw new AdminActionError("This user is already suspended.");
  await d.repo.update(u.id, { plan: "suspended" });
  const revokedTokens = await d.repo.revokeTokens(u.id, d.now());
  await d.audit({
    actor,
    action: "admin.user.suspended",
    target: u.id,
    meta: { previousPlan: u.plan, before: u.plan, after: "suspended", revokedTokens },
  });
}

export async function unsuspendUser(d: UserActionDeps, actor: string, input: { userId: unknown }) {
  const u = await loadUser(d, input.userId);
  if (u.plan !== "suspended") throw new AdminActionError("This user is not suspended.");
  const previous = await d.repo.previousPlanBeforeSuspend(u.id);
  const restored: Plan = previous && previous !== "suspended" ? previous : "trial";
  await d.repo.update(u.id, { plan: restored });
  await d.audit({
    actor,
    action: "admin.user.unsuspended",
    target: u.id,
    meta: { before: "suspended", after: restored, restoredFromAudit: previous !== null },
  });
}
