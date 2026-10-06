import { and, count, desc, eq, gte, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, googleConnections, oauthTokens, planGrants, usageEvents, users } from "@/server/db/schema";
import type { Plan } from "@/config/plans";
import type { GrantRow, GrantsRepo } from "./grants";
import { likePattern, offsetFor, type AdminUserDetail, type AdminUserRow, type AdminUsersRepo, type AuditFn } from "./users";

export const drizzleAudit: AuditFn = async (e) => {
  await db().insert(auditLog).values({ actor: e.actor, action: e.action, target: e.target ?? null, meta: e.meta ?? null });
};

const WEEK_MS = 7 * 86_400_000;

export function drizzleAdminUsersRepo(now: () => Date = () => new Date()): AdminUsersRepo {
  const selection = (since: Date) => {
    const calls = db()
      .select({ userId: usageEvents.userId, n: count().as("n") })
      .from(usageEvents)
      .where(gte(usageEvents.createdAt, since))
      .groupBy(usageEvents.userId)
      .as("calls");
    return { calls };
  };

  return {
    async list(p) {
      const since = new Date(now().getTime() - WEEK_MS);
      const { calls } = selection(since);
      const conds: SQL[] = [];
      if (p.q) conds.push(sql`lower(${users.email}) like ${likePattern(p.q)} escape '\\'`);
      if (p.plan) conds.push(eq(users.plan, p.plan));
      const where = conds.length ? and(...conds) : undefined;

      const [{ total }] = await db().select({ total: count() }).from(users).where(where);
      const rows = await db()
        .select({
          id: users.id,
          email: users.email,
          plan: users.plan,
          trialEndsAt: users.trialEndsAt,
          lastSeenAt: users.lastSeenAt,
          createdAt: users.createdAt,
          connectionStatus: googleConnections.status,
          calls7d: sql<number>`coalesce(${calls.n}, 0)`.mapWith(Number),
        })
        .from(users)
        .leftJoin(googleConnections, eq(googleConnections.userId, users.id))
        .leftJoin(calls, eq(calls.userId, users.id))
        .where(where)
        .orderBy(desc(users.createdAt), users.id)
        .limit(p.pageSize)
        .offset(offsetFor(p));
      return { rows: rows as AdminUserRow[], total };
    },
    async get(id): Promise<AdminUserDetail | null> {
      const since = new Date(now().getTime() - WEEK_MS);
      const [u] = await db()
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          notes: users.notes,
          plan: users.plan,
          trialEndsAt: users.trialEndsAt,
          lastSeenAt: users.lastSeenAt,
          createdAt: users.createdAt,
          connectionStatus: googleConnections.status,
          googleEmail: googleConnections.googleEmail,
        })
        .from(users)
        .leftJoin(googleConnections, eq(googleConnections.userId, users.id))
        .where(eq(users.id, id))
        .limit(1);
      if (!u) return null;
      const [{ n }] = await db()
        .select({ n: count() })
        .from(usageEvents)
        .where(and(eq(usageEvents.userId, id), gte(usageEvents.createdAt, since)));
      return { ...u, calls7d: n };
    },
    async update(id, patch) {
      await db().update(users).set(patch).where(eq(users.id, id));
    },
    async revokeTokens(id, at) {
      const rows = await db()
        .update(oauthTokens)
        .set({ revokedAt: at })
        .where(and(eq(oauthTokens.userId, id), isNull(oauthTokens.revokedAt)))
        .returning({ h: oauthTokens.tokenHash });
      return rows.length;
    },
    async previousPlanBeforeSuspend(id) {
      const [r] = await db()
        .select({ meta: auditLog.meta })
        .from(auditLog)
        .where(and(eq(auditLog.action, "admin.user.suspended"), eq(auditLog.target, id)))
        .orderBy(desc(auditLog.id))
        .limit(1);
      const prev = r?.meta?.previousPlan;
      return typeof prev === "string" ? (prev as Plan) : null;
    },
  };
}

export function drizzleGrantsRepo(): GrantsRepo {
  return {
    async findUsersByEmails(emails) {
      if (emails.length === 0) return [];
      const rows = await db()
        .select({ id: users.id, email: users.email, plan: users.plan })
        .from(users)
        .where(inArray(sql`lower(${users.email})`, emails));
      return rows;
    },
    async setUserPlan(userId, plan) {
      await db().update(users).set({ plan }).where(eq(users.id, userId));
    },
    async upsertGrant(g) {
      await db()
        .insert(planGrants)
        .values(g)
        .onConflictDoUpdate({
          target: planGrants.email,
          set: { plan: g.plan, note: g.note, createdBy: g.createdBy, createdAt: new Date(), appliedAt: null },
        });
    },
    async list(): Promise<GrantRow[]> {
      return db().select().from(planGrants).orderBy(desc(planGrants.createdAt)).limit(500);
    },
    async deletePending(email) {
      const rows = await db()
        .delete(planGrants)
        .where(and(eq(planGrants.email, email), isNull(planGrants.appliedAt)))
        .returning({ e: planGrants.email });
      return rows.length > 0;
    },
  };
}
