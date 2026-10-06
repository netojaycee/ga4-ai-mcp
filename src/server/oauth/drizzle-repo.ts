import { and, eq, inArray, isNull } from "drizzle-orm";
import { db } from "@/server/db/client";
import { oauthAuthCodes, oauthClients, oauthTokens } from "@/server/db/schema";
import type { AuthCode, ClientRepo, CodeRepo, OAuthClient, TokenRecord, TokenRepo } from "./repo";

export function drizzleClientRepo(): ClientRepo {
  return {
    async create(c: OAuthClient) {
      await db().insert(oauthClients).values(c);
    },
    async find(clientId) {
      const [row] = await db().select().from(oauthClients).where(eq(oauthClients.clientId, clientId)).limit(1);
      return row ?? null;
    },
  };
}

export function drizzleCodeRepo(): CodeRepo {
  return {
    async insert(code: AuthCode) {
      await db().insert(oauthAuthCodes).values(code);
    },
    async find(codeHash) {
      const [row] = await db().select().from(oauthAuthCodes).where(eq(oauthAuthCodes.codeHash, codeHash)).limit(1);
      return row ?? null;
    },
    async markUsed(codeHash, at) {
      const rows = await db()
        .update(oauthAuthCodes)
        .set({ usedAt: at })
        .where(and(eq(oauthAuthCodes.codeHash, codeHash), isNull(oauthAuthCodes.usedAt)))
        .returning({ h: oauthAuthCodes.codeHash });
      return rows.length === 1;
    },
  };
}

export function drizzleTokenRepo(): TokenRepo {
  return {
    async insert(t: TokenRecord) {
      await db().insert(oauthTokens).values(t);
    },
    async find(tokenHash) {
      const [row] = await db().select().from(oauthTokens).where(eq(oauthTokens.tokenHash, tokenHash)).limit(1);
      return row ?? null;
    },
    async findChildren(parentHashes) {
      if (parentHashes.length === 0) return [];
      return db().select().from(oauthTokens).where(inArray(oauthTokens.parentHash, parentHashes));
    },
    async revokeIfActive(tokenHash, at) {
      const rows = await db()
        .update(oauthTokens)
        .set({ revokedAt: at })
        .where(and(eq(oauthTokens.tokenHash, tokenHash), isNull(oauthTokens.revokedAt)))
        .returning({ h: oauthTokens.tokenHash });
      return rows.length === 1;
    },
    async revokeMany(tokenHashes, at) {
      if (tokenHashes.length === 0) return;
      await db()
        .update(oauthTokens)
        .set({ revokedAt: at })
        .where(and(inArray(oauthTokens.tokenHash, tokenHashes), isNull(oauthTokens.revokedAt)));
    },
  };
}
