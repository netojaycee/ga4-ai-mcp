import { eq, isNull, and } from "drizzle-orm";
import { db } from "@/server/db/client";
import { auditLog, googleConnections, oauthTokens, users } from "@/server/db/schema";
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
  deleteUser(userId: string): Promise<void>;
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
      await db().delete(users).where(eq(users.id, userId));
    },
    async audit(e) {
      await db().insert(auditLog).values({ actor: e.actor, action: e.action, target: e.target ?? null, meta: e.meta ?? null });
    },
  };
}
