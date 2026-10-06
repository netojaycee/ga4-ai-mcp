import { describe, expect, it } from "vitest";
import type { Plan } from "@/config/plans";
import { applyGrants, GrantInputError, MAX_GRANT_EMAILS, parseEmailList, revokeGrant, type GrantRow, type GrantsRepo } from "@/server/admin/grants";
import type { AuditEntry } from "@/server/admin/users";
import { handleCallback, handleStart, STATE_COOKIE } from "@/server/connect/flow";
import { cookieFrom, FakeGoogle, FakeRepo, idToken, makeDeps } from "../connect/fakes";

function fakeGrantsRepo(users: { id: string; email: string; plan: Plan }[] = []) {
  const grants = new Map<string, GrantRow>();
  const repo: GrantsRepo = {
    findUsersByEmails: async (emails) => users.filter((u) => emails.includes(u.email.toLowerCase())),
    setUserPlan: async (id, plan) => {
      const u = users.find((x) => x.id === id);
      if (u) u.plan = plan;
    },
    upsertGrant: async (g) => {
      grants.set(g.email, { ...g, createdAt: new Date(), appliedAt: null });
    },
    list: async () => [...grants.values()],
    deletePending: async (email) => {
      const g = grants.get(email);
      if (!g || g.appliedAt) return false;
      grants.delete(email);
      return true;
    },
  };
  const audits: AuditEntry[] = [];
  return { repo, grants, users, audits, deps: { repo, audit: async (e: AuditEntry) => void audits.push(e) } };
}

describe("parseEmailList", () => {
  it("splits on commas, semicolons, spaces and newlines, lower-cases and de-duplicates", () => {
    const r = parseEmailList("A@x.com, b@x.com\nc@x.com;  a@X.com\r\n<d@x.com>");
    expect(r.valid).toEqual(["a@x.com", "b@x.com", "c@x.com", "d@x.com"]);
    expect(r.duplicates).toBe(1);
    expect(r.invalid).toEqual([]);
  });

  it("reports invalid addresses", () => {
    const r = parseEmailList("ok@x.com, nope, @x.com, a@b");
    expect(r.valid).toEqual(["ok@x.com"]);
    expect(r.invalid).toEqual(["nope", "@x.com", "a@b"]);
  });
});

describe("applyGrants", () => {
  it("updates existing users (audited, case-insensitive) and pre-approves future ones", async () => {
    const f = fakeGrantsRepo([{ id: "u1", email: "Ann@X.com", plan: "trial" }]);
    const r = await applyGrants(f.deps, "admin@x.com", { emails: "ann@x.com\nnew@x.com", plan: "internal", note: " team " });
    expect(r).toMatchObject({ updated: ["ann@x.com"], pending: ["new@x.com"], alreadyOnPlan: [], invalid: [] });
    expect(f.users[0].plan).toBe("internal");
    expect(f.grants.get("new@x.com")).toMatchObject({ plan: "internal", note: "team", createdBy: "admin@x.com", appliedAt: null });
    expect(f.audits.map((a) => a.action)).toEqual(["admin.user.plan_changed", "admin.grant.created"]);
    expect(f.audits[0]).toMatchObject({ actor: "admin@x.com", target: "u1", meta: { before: "trial", after: "internal" } });
  });

  it("skips users already on the plan, reports invalid and duplicates", async () => {
    const f = fakeGrantsRepo([{ id: "u1", email: "a@x.com", plan: "internal" }]);
    const r = await applyGrants(f.deps, "admin", { emails: "a@x.com, a@x.com, bad, b@x.com", plan: "internal", note: null });
    expect(r).toMatchObject({ alreadyOnPlan: ["a@x.com"], pending: ["b@x.com"], invalid: ["bad"], duplicates: 1 });
  });

  it("rejects over 200 addresses, no valid addresses, unknown plans", async () => {
    const f = fakeGrantsRepo();
    const many = Array.from({ length: MAX_GRANT_EMAILS + 1 }, (_, i) => `u${i}@x.com`).join(",");
    await expect(applyGrants(f.deps, "a", { emails: many, plan: "internal", note: null })).rejects.toThrow(/At most 200/);
    const ok = Array.from({ length: MAX_GRANT_EMAILS }, (_, i) => `u${i}@x.com`).join(",");
    await expect(applyGrants(f.deps, "a", { emails: ok, plan: "internal", note: null })).resolves.toMatchObject({ pending: expect.any(Array) });
    await expect(applyGrants(f.deps, "a", { emails: "nope", plan: "internal", note: null })).rejects.toBeInstanceOf(GrantInputError);
    await expect(applyGrants(f.deps, "a", { emails: "a@x.com", plan: "admin", note: null })).rejects.toBeInstanceOf(GrantInputError);
    await expect(applyGrants(f.deps, "a", { emails: "", plan: "internal", note: null })).rejects.toBeInstanceOf(GrantInputError);
  });

  it("re-granting the same pending email replaces it (no duplicates)", async () => {
    const f = fakeGrantsRepo();
    await applyGrants(f.deps, "a", { emails: "n@x.com", plan: "internal", note: null });
    await applyGrants(f.deps, "a", { emails: "N@x.com", plan: "paid", note: "later" });
    expect(f.grants.size).toBe(1);
    expect(f.grants.get("n@x.com")).toMatchObject({ plan: "paid", note: "later" });
  });
});

describe("revokeGrant", () => {
  it("deletes pending grants only and audits", async () => {
    const f = fakeGrantsRepo();
    await applyGrants(f.deps, "a", { emails: "n@x.com", plan: "internal", note: null });
    await revokeGrant(f.deps, "admin", "N@x.com");
    expect(f.grants.size).toBe(0);
    expect(f.audits.at(-1)).toEqual({ actor: "admin", action: "admin.grant.revoked", target: "n@x.com" });
    await expect(revokeGrant(f.deps, "admin", "n@x.com")).rejects.toThrow(/No pending/);
    await expect(revokeGrant(f.deps, "admin", "bad")).rejects.toThrow(/Invalid/);
  });
});

describe("grants applied at first sign-in", () => {
  async function signIn(repo: FakeRepo, email: string, sub = "sub-1") {
    const google = new FakeGoogle();
    google.tokens = { ...google.tokens, idToken: idToken({ email, sub }) };
    const d = makeDeps(repo, google);
    const start = handleStart(new Request("https://insights.example.com/api/connect/google/start"), d);
    const state = new URL(start.headers.get("location")!).searchParams.get("state")!;
    const cookie = cookieFrom(start, STATE_COOKIE);
    return handleCallback(new Request(`https://insights.example.com/api/connect/google/callback?code=c&state=${state}`, { headers: { cookie } }), d);
  }

  it("gives an internal grant the plan, no trial end, marks it applied and audits", async () => {
    const repo = new FakeRepo();
    repo.grants.set("team@example.com", { plan: "internal", appliedAt: null });
    const res = await signIn(repo, "Team@Example.com");
    expect(res.status).toBe(302);
    const u = [...repo.users.values()][0];
    expect(u).toMatchObject({ plan: "internal", trialEndsAt: null });
    expect(repo.grants.get("team@example.com")?.appliedAt).toBeInstanceOf(Date);
    expect(repo.audits.some((a) => a.action === "admin.grant.applied")).toBe(true);
  });

  it("a paid grant keeps the trial end calculation", async () => {
    const repo = new FakeRepo();
    repo.grants.set("a@example.com", { plan: "paid", appliedAt: null });
    await signIn(repo, "a@example.com");
    expect([...repo.users.values()][0].plan).toBe("paid");
  });

  it("without a grant the default trial applies; applied grants are not reused", async () => {
    const repo = new FakeRepo();
    await signIn(repo, "a@example.com");
    expect([...repo.users.values()][0]).toMatchObject({ plan: "trial" });
    expect([...repo.users.values()][0].trialEndsAt).not.toBeNull();

    const repo2 = new FakeRepo();
    repo2.grants.set("b@example.com", { plan: "internal", appliedAt: new Date(0) });
    await signIn(repo2, "b@example.com");
    expect([...repo2.users.values()][0].plan).toBe("trial");
  });

  it("does not touch the plan of an existing user signing in again", async () => {
    const repo = new FakeRepo();
    await signIn(repo, "a@example.com");
    repo.grants.set("a@example.com", { plan: "internal", appliedAt: null });
    await signIn(repo, "a@example.com");
    expect([...repo.users.values()][0].plan).toBe("trial");
    expect(repo.grants.get("a@example.com")?.appliedAt).toBeNull();
  });
});
