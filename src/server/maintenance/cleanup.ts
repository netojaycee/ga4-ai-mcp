import { and, eq, lt, notExists, or, sql } from "drizzle-orm";
import { db } from "@/server/db/client";
import {
  anonRateCounters,
  auditLog,
  deletedAccounts,
  oauthAuthCodes,
  oauthClients,
  oauthTokens,
  rateCounters,
  usageEvents,
} from "@/server/db/schema";

const DAY = 86_400_000;

/** Retention windows. The privacy policy promises usage records are kept for a limited period. */
export const RETENTION = {
  usageEventsDays: 90,
  auditLogDays: 365,
  tombstoneDays: 365,
  tokensDaysAfterExpiry: 30,
  authCodesDaysAfterExpiry: 1,
  unusedClientDays: 7,
  minuteCounterDays: 2,
  hourCounterDays: 2,
  dayCounterDays: 7,
} as const;

export interface CleanupStore {
  deleteUnusedClients(createdBefore: Date): Promise<number>;
  deleteDeadTokens(before: Date): Promise<number>;
  deleteDeadAuthCodes(expiredBefore: Date): Promise<number>;
  deleteOldUsageEvents(before: Date): Promise<number>;
  deleteOldAuditLog(before: Date): Promise<number>;
  deleteOldTombstones(before: Date): Promise<number>;
  /** Window keys sort lexicographically in time, so a cutoff key deletes everything older. */
  deleteOldRateCounters(minuteKeyCutoff: string, dayKeyCutoff: string): Promise<number>;
  deleteOldAnonCounters(hourKeyCutoff: string, dayKeyCutoff: string): Promise<number>;
}

export interface CleanupSummary {
  unusedClients: number;
  deadTokens: number;
  deadAuthCodes: number;
  usageEvents: number;
  auditLog: number;
  tombstones: number;
  rateCounters: number;
  anonCounters: number;
}

const minuteKeyAt = (d: Date) => `m:${d.toISOString().slice(0, 16)}`;
const hourKeyAt = (d: Date) => `h:${d.toISOString().slice(0, 13)}`;
const dayKeyAt = (d: Date) => `d:${d.toISOString().slice(0, 10)}`;
const ago = (now: Date, days: number) => new Date(now.getTime() - days * DAY);

/** Order matters: tokens first, so clients whose tokens just expired become "unused" on the next run. */
export async function runCleanup(store: CleanupStore, now: Date): Promise<CleanupSummary> {
  const deadTokens = await store.deleteDeadTokens(ago(now, RETENTION.tokensDaysAfterExpiry));
  const deadAuthCodes = await store.deleteDeadAuthCodes(ago(now, RETENTION.authCodesDaysAfterExpiry));
  const unusedClients = await store.deleteUnusedClients(ago(now, RETENTION.unusedClientDays));
  const usageEventsDeleted = await store.deleteOldUsageEvents(ago(now, RETENTION.usageEventsDays));
  const auditLogDeleted = await store.deleteOldAuditLog(ago(now, RETENTION.auditLogDays));
  const tombstones = await store.deleteOldTombstones(ago(now, RETENTION.tombstoneDays));
  const rate = await store.deleteOldRateCounters(
    minuteKeyAt(ago(now, RETENTION.minuteCounterDays)),
    dayKeyAt(ago(now, RETENTION.dayCounterDays)),
  );
  const anon = await store.deleteOldAnonCounters(
    hourKeyAt(ago(now, RETENTION.hourCounterDays)),
    dayKeyAt(ago(now, RETENTION.dayCounterDays)),
  );
  return {
    unusedClients,
    deadTokens,
    deadAuthCodes,
    usageEvents: usageEventsDeleted,
    auditLog: auditLogDeleted,
    tombstones,
    rateCounters: rate,
    anonCounters: anon,
  };
}

export function drizzleCleanupStore(): CleanupStore {
  return {
    async deleteUnusedClients(createdBefore) {
      const rows = await db()
        .delete(oauthClients)
        .where(
          and(
            lt(oauthClients.createdAt, createdBefore),
            notExists(db().select({ one: sql`1` }).from(oauthTokens).where(eq(oauthTokens.clientId, oauthClients.clientId))),
            notExists(
              db().select({ one: sql`1` }).from(oauthAuthCodes).where(eq(oauthAuthCodes.clientId, oauthClients.clientId)),
            ),
          ),
        )
        .returning({ id: oauthClients.clientId });
      return rows.length;
    },
    async deleteDeadTokens(before) {
      const rows = await db()
        .delete(oauthTokens)
        .where(or(lt(oauthTokens.expiresAt, before), lt(oauthTokens.revokedAt, before)))
        .returning({ id: oauthTokens.tokenHash });
      return rows.length;
    },
    async deleteDeadAuthCodes(expiredBefore) {
      const rows = await db()
        .delete(oauthAuthCodes)
        .where(lt(oauthAuthCodes.expiresAt, expiredBefore))
        .returning({ id: oauthAuthCodes.codeHash });
      return rows.length;
    },
    async deleteOldUsageEvents(before) {
      const rows = await db().delete(usageEvents).where(lt(usageEvents.createdAt, before)).returning({ id: usageEvents.id });
      return rows.length;
    },
    async deleteOldAuditLog(before) {
      const rows = await db().delete(auditLog).where(lt(auditLog.createdAt, before)).returning({ id: auditLog.id });
      return rows.length;
    },
    async deleteOldTombstones(before) {
      const rows = await db()
        .delete(deletedAccounts)
        .where(lt(deletedAccounts.deletedAt, before))
        .returning({ k: deletedAccounts.subHash });
      return rows.length;
    },
    async deleteOldRateCounters(minuteKeyCutoff, dayKeyCutoff) {
      const rows = await db()
        .delete(rateCounters)
        .where(
          or(
            and(sql`${rateCounters.windowKey} like 'm:%'`, lt(rateCounters.windowKey, minuteKeyCutoff)),
            and(sql`${rateCounters.windowKey} like 'd:%'`, lt(rateCounters.windowKey, dayKeyCutoff)),
          ),
        )
        .returning({ k: rateCounters.windowKey });
      return rows.length;
    },
    async deleteOldAnonCounters(hourKeyCutoff, dayKeyCutoff) {
      const rows = await db()
        .delete(anonRateCounters)
        .where(
          or(
            and(sql`${anonRateCounters.windowKey} like 'h:%'`, lt(anonRateCounters.windowKey, hourKeyCutoff)),
            and(sql`${anonRateCounters.windowKey} like 'd:%'`, lt(anonRateCounters.windowKey, dayKeyCutoff)),
          ),
        )
        .returning({ k: anonRateCounters.bucket });
      return rows.length;
    },
  };
}
