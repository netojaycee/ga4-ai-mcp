import { describe, expect, it } from "vitest";
import type { Plan } from "@/config/plans";
import {
  AdminActionError,
  changeNotes,
  changePlan,
  changeTrial,
  computeTrialEnd,
  daysLeft,
  disconnectGoogle,
  likePattern,
  offsetFor,
  parseListParams,
  revokeSessions,
  suspendUser,
  unsuspendUser,
  type AdminUserDetail,
  type AdminUsersRepo,
  type AuditEntry,
  type UserActionDeps,
} from "@/server/admin/users";

const NOW = new Date("2026-10-06T12:00:00Z");
const ID = "00000000-0000-4000-8000-000000000001";
const ADMIN = "admin@example.com";

function setup(over: Partial<AdminUserDetail> = {}) {
  const user: AdminUserDetail = {
    id: ID,
    email: "u@example.com",
    plan: "trial",
    trialEndsAt: new Date("2026-10-10T00:00:00Z"),
    connectionStatus: "active",
    lastSeenAt: null,
    calls7d: 0,
    createdAt: NOW,
    name: null,
    notes: null,
    googleEmail: "u@example.com",
    ...over,
  };
  const audits: AuditEntry[] = [];
  const tokens = { active: 3, revokedAt: null as Date | null };
  let lastSuspendedFrom: Plan | null = null;
  const repo: AdminUsersRepo = {
    list: async () => ({ rows: [], total: 0 }),
    get: async (id) => (id === user.id ? { ...user } : null),
    update: async (_id, patch) => {
      Object.assign(user, patch);
    },
    revokeTokens: async (_id, now) => {
      const n = tokens.active;
      tokens.active = 0;
      tokens.revokedAt = now;
      return n;
    },
    previousPlanBeforeSuspend: async () => lastSuspendedFrom,
  };
  const deps: UserActionDeps = {
    repo,
    audit: async (e) => {
      audits.push(e);
      if (e.action === "admin.user.suspended") lastSuspendedFrom = (e.meta as { previousPlan: Plan }).previousPlan;
    },
    now: () => NOW,
    disconnect: async (userId, actor) => {
      audits.push({ actor, action: "admin.user.google_disconnected", target: userId });
      return { googleRevoked: true, revokedTokens: 2 };
    },
  };
  return { user, audits, tokens, deps };
}

describe("changePlan", () => {
  it("updates the plan and writes an audit row with before/after", async () => {
    const { user, audits, deps } = setup();
    await changePlan(deps, ADMIN, { userId: ID, plan: "paid" });
    expect(user.plan).toBe("paid");
    expect(audits).toEqual([{ actor: ADMIN, action: "admin.user.plan_changed", target: ID, meta: { before: "trial", after: "paid" } }]);
  });

  it("rejects unknown plans and unknown users without writing", async () => {
    const { user, audits, deps } = setup();
    await expect(changePlan(deps, ADMIN, { userId: ID, plan: "god" })).rejects.toBeInstanceOf(AdminActionError);
    await expect(changePlan(deps, ADMIN, { userId: "not-a-uuid", plan: "paid" })).rejects.toBeInstanceOf(AdminActionError);
    await expect(changePlan(deps, ADMIN, { userId: "00000000-0000-4000-8000-0000000000ff", plan: "paid" })).rejects.toThrow(/not found/);
    expect(user.plan).toBe("trial");
    expect(audits).toHaveLength(0);
  });

  it("is a no-op (no audit) when the plan is unchanged", async () => {
    const { audits, deps } = setup();
    await changePlan(deps, ADMIN, { userId: ID, plan: "trial" });
    expect(audits).toHaveLength(0);
  });
});

describe("changeTrial", () => {
  it("extends from the current end when it is in the future", async () => {
    const { user, audits, deps } = setup();
    await changeTrial(deps, ADMIN, { userId: ID, trial: { mode: "extend", days: "7" } });
    expect(user.trialEndsAt?.toISOString()).toBe("2026-10-17T00:00:00.000Z");
    expect(audits[0]).toMatchObject({
      action: "admin.user.trial_changed",
      meta: { before: "2026-10-10T00:00:00.000Z", after: "2026-10-17T00:00:00.000Z", mode: "extend" },
    });
  });

  it("extends from now when the trial already ended or has no end", () => {
    expect(computeTrialEnd({ mode: "extend", days: 3 }, new Date("2026-01-01"), NOW)?.toISOString()).toBe("2026-10-09T12:00:00.000Z");
    expect(computeTrialEnd({ mode: "extend", days: 3 }, null, NOW)?.toISOString()).toBe("2026-10-09T12:00:00.000Z");
  });

  it("sets an explicit date (end of day UTC) and clears", async () => {
    const { user, deps } = setup();
    await changeTrial(deps, ADMIN, { userId: ID, trial: { mode: "set", date: "2026-12-31" } });
    expect(user.trialEndsAt?.toISOString()).toBe("2026-12-31T23:59:59.000Z");
    await changeTrial(deps, ADMIN, { userId: ID, trial: { mode: "clear" } });
    expect(user.trialEndsAt).toBeNull();
  });

  it("validates days and dates", async () => {
    const { audits, deps } = setup();
    for (const trial of [
      { mode: "extend", days: "0" },
      { mode: "extend", days: "366" },
      { mode: "extend", days: "abc" },
      { mode: "extend", days: "1.5" },
      { mode: "set", date: "tomorrow" },
      { mode: "set", date: "2026-02-31" },
      { mode: "nope" },
    ]) {
      await expect(changeTrial(deps, ADMIN, { userId: ID, trial })).rejects.toBeInstanceOf(AdminActionError);
    }
    expect(audits).toHaveLength(0);
  });
});

describe("changeNotes", () => {
  it("saves trimmed notes, empty becomes null, and audits sizes only", async () => {
    const { user, audits, deps } = setup();
    await changeNotes(deps, ADMIN, { userId: ID, notes: "  vip customer  " });
    expect(user.notes).toBe("vip customer");
    expect(audits[0].meta).toEqual({ beforeLength: 0, afterLength: 12 });
    await changeNotes(deps, ADMIN, { userId: ID, notes: "   " });
    expect(user.notes).toBeNull();
  });

  it("rejects over-long notes", async () => {
    const { deps } = setup();
    await expect(changeNotes(deps, ADMIN, { userId: ID, notes: "x".repeat(2001) })).rejects.toBeInstanceOf(AdminActionError);
  });
});

describe("revoke, disconnect, suspend", () => {
  it("revokeSessions requires confirmation, revokes tokens and audits", async () => {
    const { tokens, audits, deps } = setup();
    await expect(revokeSessions(deps, ADMIN, { userId: ID, confirm: undefined })).rejects.toThrow(/confirm/i);
    expect(tokens.active).toBe(3);
    await expect(revokeSessions(deps, ADMIN, { userId: ID, confirm: "yes" })).resolves.toBe(3);
    expect(tokens.active).toBe(0);
    expect(tokens.revokedAt).toEqual(NOW);
    expect(audits).toEqual([{ actor: ADMIN, action: "admin.user.sessions_revoked", target: ID, meta: { revokedTokens: 3 } }]);
  });

  it("disconnectGoogle requires confirmation and delegates with the admin as actor", async () => {
    const { audits, deps } = setup();
    await expect(disconnectGoogle(deps, ADMIN, { userId: ID, confirm: "" })).rejects.toThrow(/confirm/i);
    expect(audits).toHaveLength(0);
    await expect(disconnectGoogle(deps, ADMIN, { userId: ID, confirm: "yes" })).resolves.toEqual({ googleRevoked: true, revokedTokens: 2 });
    expect(audits[0]).toMatchObject({ actor: ADMIN, action: "admin.user.google_disconnected", target: ID });
  });

  it("suspend sets the plan, revokes tokens, and remembers the previous plan", async () => {
    const { user, tokens, audits, deps } = setup({ plan: "paid" });
    await expect(suspendUser(deps, ADMIN, { userId: ID, confirm: undefined })).rejects.toThrow(/confirm/i);
    expect(user.plan).toBe("paid");
    await suspendUser(deps, ADMIN, { userId: ID, confirm: "yes" });
    expect(user.plan).toBe("suspended");
    expect(tokens.active).toBe(0);
    expect(audits[0]).toMatchObject({
      action: "admin.user.suspended",
      meta: { previousPlan: "paid", before: "paid", after: "suspended", revokedTokens: 3 },
    });
    await expect(suspendUser(deps, ADMIN, { userId: ID, confirm: "yes" })).rejects.toThrow(/already suspended/);
  });

  it("unsuspend restores the remembered plan, or trial when unknown", async () => {
    const a = setup({ plan: "internal" });
    await suspendUser(a.deps, ADMIN, { userId: ID, confirm: "yes" });
    await unsuspendUser(a.deps, ADMIN, { userId: ID });
    expect(a.user.plan).toBe("internal");
    expect(a.audits.at(-1)).toMatchObject({ action: "admin.user.unsuspended", meta: { before: "suspended", after: "internal" } });

    const b = setup({ plan: "suspended" });
    await unsuspendUser(b.deps, ADMIN, { userId: ID });
    expect(b.user.plan).toBe("trial");

    const c = setup({ plan: "paid" });
    await expect(unsuspendUser(c.deps, ADMIN, { userId: ID })).rejects.toThrow(/not suspended/);
  });
});

describe("list query building", () => {
  it("normalises search, plan filter and page", () => {
    expect(parseListParams({})).toEqual({ q: "", plan: null, page: 1, pageSize: 25 });
    expect(parseListParams({ q: "  Ann@X.com ", plan: "paid", page: "3" })).toEqual({ q: "Ann@X.com", plan: "paid", page: 3, pageSize: 25 });
    expect(parseListParams({ plan: "bogus", page: "-4" })).toMatchObject({ plan: null, page: 1 });
    expect(parseListParams({ page: "abc" }).page).toBe(1);
    expect(parseListParams({ q: ["a", "b"], page: ["2"] })).toMatchObject({ q: "a", page: 2 });
    expect(parseListParams({ q: "x".repeat(500) }).q).toHaveLength(200);
  });

  it("computes offsets", () => {
    expect(offsetFor({ page: 1, pageSize: 25 })).toBe(0);
    expect(offsetFor({ page: 4, pageSize: 25 })).toBe(75);
  });

  it("escapes LIKE wildcards and lower-cases", () => {
    expect(likePattern("Ann")).toBe("%ann%");
    expect(likePattern("100%_a\\b")).toBe("%100\\%\\_a\\\\b%");
  });

  it("computes days left", () => {
    expect(daysLeft(null, NOW)).toBeNull();
    expect(daysLeft(new Date("2026-10-08T12:00:00Z"), NOW)).toBe(2);
    expect(daysLeft(new Date("2026-10-05T12:00:00Z"), NOW)).toBe(-1);
  });
});
