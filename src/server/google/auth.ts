import { eq } from "drizzle-orm";
import { z } from "zod";
import { env } from "@/config/env";
import { db } from "@/server/db/client";
import { googleConnections } from "@/server/db/schema";
import { ToolError } from "@/server/errors";
import { decryptSecret, encryptSecret, needsReencryption, payloadVersion } from "@/server/security/crypto";

/** Anything the data layer needs to call Google on a user's behalf. */
export interface GoogleAuth {
  /** A currently valid access token, refreshed transparently when it is about to expire. */
  getAccessToken(): Promise<string>;
}

export interface ConnectionRow {
  id: string;
  refreshTokenEnc: string;
  status: "active" | "revoked" | "error";
}

/** Narrow persistence interface so tests never need a database. */
export interface ConnectionStore {
  findByUserId(userId: string): Promise<ConnectionRow | undefined>;
  markRefreshed(id: string, update: { at: Date; refreshTokenEnc?: string; encKeyVersion?: number }): Promise<void>;
  markError(id: string): Promise<void>;
}

export interface TokenResponse {
  accessToken: string;
  expiresInSec: number;
}

/** Thrown by a TokenClient when Google says the refresh token is dead (revoked, expired, user removed access). */
export class InvalidGrantError extends Error {
  constructor() {
    super("Google refresh token is no longer valid");
    this.name = "InvalidGrantError";
  }
}

export interface TokenClient {
  /** Throws InvalidGrantError for invalid_grant, any other Error for transient failures. */
  refresh(refreshToken: string): Promise<TokenResponse>;
}

export interface SecretCodec {
  decrypt(payload: string): string;
  encrypt(plaintext: string): string;
  needsReencryption(payload: string): boolean;
  versionOf(payload: string): number;
}

export interface AccessTokenCache {
  get(userId: string): { token: string; expiresAt: number } | undefined;
  set(userId: string, value: { token: string; expiresAt: number }): void;
  delete(userId: string): void;
}

export interface AuthDeps {
  store: ConnectionStore;
  tokens: TokenClient;
  codec: SecretCodec;
  cache: AccessTokenCache;
  now: () => number;
}

const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Refresh slightly early so a token never expires mid-request. */
const EXPIRY_SKEW_MS = 60_000;

const tokenBody = z.object({ access_token: z.string().min(1), expires_in: z.number().positive() });

/** Real token client: plain fetch against Google's token endpoint using the app's client credentials. */
export function createFetchTokenClient(fetchImpl: typeof fetch = fetch): TokenClient {
  return {
    async refresh(refreshToken) {
      const res = await fetchImpl(TOKEN_URL, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          client_id: env().GOOGLE_CLIENT_ID,
          client_secret: env().GOOGLE_CLIENT_SECRET,
          refresh_token: refreshToken,
        }),
        signal: AbortSignal.timeout(15_000),
      });
      const json: unknown = await res.json().catch(() => undefined);
      if (!res.ok) {
        const code = (json as { error?: unknown } | undefined)?.error;
        if (code === "invalid_grant") throw new InvalidGrantError();
        // Deliberately no body or code in the message.
        throw new Error(`Google token endpoint returned HTTP ${res.status}`);
      }
      const parsed = tokenBody.parse(json);
      return { accessToken: parsed.access_token, expiresInSec: parsed.expires_in };
    },
  };
}

export function createDrizzleConnectionStore(): ConnectionStore {
  return {
    async findByUserId(userId) {
      const [row] = await db()
        .select({
          id: googleConnections.id,
          refreshTokenEnc: googleConnections.refreshTokenEnc,
          status: googleConnections.status,
        })
        .from(googleConnections)
        .where(eq(googleConnections.userId, userId))
        .limit(1);
      return row;
    },
    async markRefreshed(id, update) {
      await db()
        .update(googleConnections)
        .set({
          lastRefreshAt: update.at,
          ...(update.refreshTokenEnc !== undefined
            ? { refreshTokenEnc: update.refreshTokenEnc, encKeyVersion: update.encKeyVersion }
            : {}),
        })
        .where(eq(googleConnections.id, id));
    },
    async markError(id) {
      await db().update(googleConnections).set({ status: "error" }).where(eq(googleConnections.id, id));
    },
  };
}

const defaultCodec: SecretCodec = {
  decrypt: decryptSecret,
  encrypt: encryptSecret,
  needsReencryption,
  versionOf: (p) => Number(payloadVersion(p)),
};

/** Access tokens live only in process memory, for at most their natural lifetime. */
const memoryCache = new Map<string, { token: string; expiresAt: number }>();
const defaultCache: AccessTokenCache = {
  get: (k) => memoryCache.get(k),
  set: (k, v) => void memoryCache.set(k, v),
  delete: (k) => void memoryCache.delete(k),
};

const reconnect = () =>
  new ToolError(
    "reconnect_required",
    "The Google connection for this account is no longer valid (access was revoked or expired). Ask the user to reconnect their Google account, then try again.",
  );

/**
 * Loads the user's Google connection and returns a GoogleAuth that refreshes access tokens on demand.
 * Throws `auth_required` when no connection exists and `reconnect_required` when it is revoked/errored.
 */
export async function getGoogleAuth(userId: string, overrides: Partial<AuthDeps> = {}): Promise<GoogleAuth> {
  const deps: AuthDeps = {
    store: overrides.store ?? createDrizzleConnectionStore(),
    tokens: overrides.tokens ?? createFetchTokenClient(),
    codec: overrides.codec ?? defaultCodec,
    cache: overrides.cache ?? defaultCache,
    now: overrides.now ?? Date.now,
  };

  const conn = await deps.store.findByUserId(userId);
  if (!conn) {
    throw new ToolError(
      "auth_required",
      "No Google account is connected yet. Ask the user to connect their Google account (Analytics and Search Console, read-only) first.",
    );
  }
  if (conn.status !== "active") throw reconnect();

  let refreshToken: string;
  try {
    refreshToken = deps.codec.decrypt(conn.refreshTokenEnc);
  } catch (cause) {
    throw new ToolError("reconnect_required", reconnect().userMessage, { cause });
  }

  let reencrypted = false;
  return {
    async getAccessToken() {
      const cached = deps.cache.get(userId);
      if (cached && cached.expiresAt - EXPIRY_SKEW_MS > deps.now()) return cached.token;

      let res: TokenResponse;
      try {
        res = await deps.tokens.refresh(refreshToken);
      } catch (e) {
        deps.cache.delete(userId);
        if (e instanceof InvalidGrantError) {
          await deps.store.markError(conn.id);
          throw reconnect();
        }
        throw new ToolError(
          "upstream_error",
          "Could not obtain a Google access token right now. This is usually temporary; try again shortly.",
          { cause: e },
        );
      }

      const update: { at: Date; refreshTokenEnc?: string; encKeyVersion?: number } = { at: new Date(deps.now()) };
      if (!reencrypted && deps.codec.needsReencryption(conn.refreshTokenEnc)) {
        const enc = deps.codec.encrypt(refreshToken);
        update.refreshTokenEnc = enc;
        update.encKeyVersion = deps.codec.versionOf(enc);
      }
      try {
        await deps.store.markRefreshed(conn.id, update);
        if (update.refreshTokenEnc) reencrypted = true;
      } catch {
        // Bookkeeping only: a failed write must not fail an otherwise good data request.
      }

      deps.cache.set(userId, { token: res.accessToken, expiresAt: deps.now() + res.expiresInSec * 1000 });
      return res.accessToken;
    },
  };
}
