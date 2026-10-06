import { eq, isNull, and, or } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, deletedAccounts, googleConnections, oauthTokens, planGrants, users } from "@/server/db/schema";
import type { Plan } from "@/config/plans";

export interface UpsertUserInput {
  googleSub: string;
  email: string;
  name: string | null;
  now: Date;
  /** Applied only when the user is created. */
  newUser: { plan: Plan; trialEndsAt: Date | null };
}

export interface UpsertConnectionInput {
  userId: string;
  googleSub: string;
  googleEmail: string;
  refreshTokenEnc: string;
  encKeyVersion: number;
  scopes: string[];
  now: Date;
}

export interface AccountView {
  userId: string;
  email: string;
  plan: Plan;
  trialEndsAt: Date | null;
  googleEmail: string | null;
  connectionStatus: "active" | "revoked" | "error" | null;
}

export interface ConnectRepository {
  upsertUser(i: UpsertUserInput): Promise<{ id: string; email: string; created: boolean }>;
  upsertConnection(i: UpsertConnectionInput): Promise<void>;
  getAccount(userId: string): Promise<AccountView | null>;
  getConnectionTokenEnc(userId: string): Promise<string | null>;
  deleteConnection(userId: string): Promise<void>;
  revokeOAuthTokens(userId: string, now: Date): Promise<number>;
  /**
   * Deletes the user (cascades) and everything that identifies them outside the cascade: audit rows about or by
   * them and pre-approvals for their email. Plan state survives only as a one-way-hash tombstone (see below).
   */
  deleteUser(userId: string): Promise<void>;
  /** Plan state remembered for a deleted account (keyed by sha256 of the Google sub), or null. */
  findTombstone(subHash: string): Promise<{ plan: Plan; trialEndsAt: Date | null } | null>;
  recordTombstone(t: { subHash: string; plan: Plan; trialEndsAt: Date | null; now: Date }): Promise<void>;
  /** Everything needed to write a tombstone before deletion. */
  getDeletionFacts(userId: string): Promise<{ googleSub: string; plan: Plan; trialEndsAt: Date | null } | null>;
  /** Unapplied pre-approved plan for this (lower-cased) email, set by an admin before first sign-in. */
  findPendingGrant(email: string): Promise<{ plan: Plan } | null>;
  markGrantApplied(email: string, now: Date): Promise<void>;
  audit(e: { actor: string; action: string; target?: string; meta?: Record<string, unknown> }): Promise<void>;
}

export function drizzleConnectRepository(): ConnectRepository {
  return {
    async upsertUser(i) {
      const [existing] = await db().select({ id: users.id }).from(users).where(eq(users.googleSub, i.googleSub)).limit(1);
      const [row] = await db()
        .insert(users)
        .values({
          googleSub: i.googleSub,
          email: i.email,
          name: i.name,
          plan: i.newUser.plan,
          trialEndsAt: i.newUser.trialEndsAt,
          lastSeenAt: i.now,
        })
        .onConflictDoUpdate({
          target: users.googleSub,
          set: { email: i.email, name: i.name, lastSeenAt: i.now },
        })
        .returning({ id: users.id, email: users.email });
      return { id: row.id, email: row.email, created: !existing };
    },
    async upsertConnection(i) {
      const values = {
        userId: i.userId,
        googleSub: i.googleSub,
        googleEmail: i.googleEmail,
        refreshTokenEnc: i.refreshTokenEnc,
        encKeyVersion: i.encKeyVersion,
        scopes: i.scopes,
        status: "active" as const,
        connectedAt: i.now,
        lastRefreshAt: null,
      };
      await db()
        .insert(googleConnections)
        .values(values)
        .onConflictDoUpdate({ target: googleConnections.userId, set: values });
    },
    async getAccount(userId) {
      const [u] = await db().select().from(users).where(eq(users.id, userId)).limit(1);
      if (!u) return null;
      const [c] = await db().select().from(googleConnections).where(eq(googleConnections.userId, userId)).limit(1);
      return {
        userId: u.id,
        email: u.email,
        plan: u.plan,
        trialEndsAt: u.trialEndsAt,
        googleEmail: c?.googleEmail ?? null,
        connectionStatus: c?.status ?? null,
      };
    },
    async getConnectionTokenEnc(userId) {
      const [c] = await db()
        .select({ t: googleConnections.refreshTokenEnc })
        .from(googleConnections)
        .where(eq(googleConnections.userId, userId))
        .limit(1);
      return c?.t ?? null;
    },
    async deleteConnection(userId) {
      await db().delete(googleConnections).where(eq(googleConnections.userId, userId));
    },
    async revokeOAuthTokens(userId, now) {
      const rows = await db()
        .update(oauthTokens)
        .set({ revokedAt: now })
        .where(and(eq(oauthTokens.userId, userId), isNull(oauthTokens.revokedAt)))
        .returning({ h: oauthTokens.tokenHash });
      return rows.length;
    },
    async deleteUser(userId) {
      const [u] = await db().select({ email: users.email }).from(users).where(eq(users.id, userId)).limit(1);
      await db().delete(users).where(eq(users.id, userId));
      await db()
        .delete(auditLog)
        .where(or(eq(auditLog.target, userId), eq(auditLog.actor, `user:${userId}`)));
      if (u) await db().delete(planGrants).where(eq(planGrants.email, u.email.toLowerCase()));
    },
    async findTombstone(subHash) {
      const [t] = await db()
        .select({ plan: deletedAccounts.plan, trialEndsAt: deletedAccounts.trialEndsAt })
        .from(deletedAccounts)
        .where(eq(deletedAccounts.subHash, subHash))
        .limit(1);
      return t ?? null;
    },
    async recordTombstone(t) {
      await db()
        .insert(deletedAccounts)
        .values({ subHash: t.subHash, plan: t.plan, trialEndsAt: t.trialEndsAt, deletedAt: t.now })
        .onConflictDoUpdate({
          target: deletedAccounts.subHash,
          set: { plan: t.plan, trialEndsAt: t.trialEndsAt, deletedAt: t.now },
        });
    },
    async getDeletionFacts(userId) {
      const [u] = await db()
        .select({ googleSub: users.googleSub, plan: users.plan, trialEndsAt: users.trialEndsAt })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);
      return u ?? null;
    },
    async findPendingGrant(email) {
      const [g] = await db()
        .select({ plan: planGrants.plan })
        .from(planGrants)
        .where(and(eq(planGrants.email, email), isNull(planGrants.appliedAt)))
        .limit(1);
      return g ?? null;
    },
    async markGrantApplied(email, now) {
      await db()
        .update(planGrants)
        .set({ appliedAt: now })
        .where(and(eq(planGrants.email, email), isNull(planGrants.appliedAt)));
    },
    async audit(e) {
      await db().insert(auditLog).values({ actor: e.actor, action: e.action, target: e.target ?? null, meta: e.meta ?? null });
    },
  };
}
