import { sql } from "drizzle-orm";
import {
  bigserial,
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { PLANS } from "@/config/plans";

const ts = (name: string) => timestamp(name, { withTimezone: true });
const createdAt = () => ts("created_at").notNull().defaultNow();

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    googleSub: text("google_sub").notNull(),
    name: text("name"),
    plan: text("plan", { enum: PLANS }).notNull().default("trial"),
    trialEndsAt: ts("trial_ends_at"),
    notes: text("notes"),
    createdAt: createdAt(),
    lastSeenAt: ts("last_seen_at"),
  },
  (t) => [uniqueIndex("users_google_sub_uq").on(t.googleSub), index("users_email_idx").on(t.email)],
);

export const googleConnections = pgTable(
  "google_connections",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    googleSub: text("google_sub").notNull(),
    googleEmail: text("google_email").notNull(),
    /** AES-256-GCM payload from server/security/crypto.ts. Never the raw token. */
    refreshTokenEnc: text("refresh_token_enc").notNull(),
    encKeyVersion: integer("enc_key_version").notNull(),
    scopes: text("scopes").array().notNull().default(sql`'{}'::text[]`),
    status: text("status", { enum: ["active", "revoked", "error"] }).notNull().default("active"),
    connectedAt: ts("connected_at").notNull().defaultNow(),
    lastRefreshAt: ts("last_refresh_at"),
  },
  (t) => [uniqueIndex("google_connections_user_uq").on(t.userId)],
);

export const oauthClients = pgTable("oauth_clients", {
  clientId: text("client_id").primaryKey(),
  clientName: text("client_name"),
  redirectUris: text("redirect_uris").array().notNull(),
  tokenEndpointAuthMethod: text("token_endpoint_auth_method").notNull().default("none"),
  createdAt: createdAt(),
});

export const oauthAuthCodes = pgTable(
  "oauth_auth_codes",
  {
    codeHash: text("code_hash").primaryKey(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    codeChallenge: text("code_challenge").notNull(),
    resource: text("resource").notNull(),
    scope: text("scope").notNull().default(""),
    expiresAt: ts("expires_at").notNull(),
    usedAt: ts("used_at"),
  },
  (t) => [index("oauth_auth_codes_expires_idx").on(t.expiresAt)],
);

export const oauthTokens = pgTable(
  "oauth_tokens",
  {
    tokenHash: text("token_hash").primaryKey(),
    kind: text("kind", { enum: ["access", "refresh"] }).notNull(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    resource: text("resource").notNull(),
    scope: text("scope").notNull().default(""),
    expiresAt: ts("expires_at").notNull(),
    revokedAt: ts("revoked_at"),
    /** Rotation chain: the refresh token this one replaced (for reuse detection). */
    parentHash: text("parent_hash"),
    createdAt: createdAt(),
  },
  (t) => [
    index("oauth_tokens_user_idx").on(t.userId),
    index("oauth_tokens_expires_idx").on(t.expiresAt),
    index("oauth_tokens_parent_idx").on(t.parentHash),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "set null" }),
    clientId: text("client_id"),
    tool: text("tool").notNull(),
    /** Property or site identifier only. Never query contents or analytics data. */
    target: text("target"),
    ok: boolean("ok").notNull(),
    errorCode: text("error_code"),
    latencyMs: integer("latency_ms"),
    rows: integer("rows"),
    createdAt: createdAt(),
  },
  (t) => [index("usage_events_user_time_idx").on(t.userId, t.createdAt)],
);

export const rateCounters = pgTable(
  "rate_counters",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** e.g. "m:2026-10-06T12:34" or "d:2026-10-06" */
    windowKey: text("window_key").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.userId, t.windowKey] })],
);

/** Rate counters for callers with no user yet (e.g. dynamic client registration). Keyed by a hashed bucket, never a raw IP. */
export const anonRateCounters = pgTable(
  "anon_rate_counters",
  {
    bucket: text("bucket").notNull(),
    windowKey: text("window_key").notNull(),
    count: integer("count").notNull().default(0),
  },
  (t) => [primaryKey({ columns: [t.bucket, t.windowKey] })],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: bigserial("id", { mode: "number" }).primaryKey(),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    target: text("target"),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: createdAt(),
  },
  (t) => [index("audit_log_time_idx").on(t.createdAt)],
);

export const adminSessions = pgTable("admin_sessions", {
  sessionHash: text("session_hash").primaryKey(),
  email: text("email").notNull(),
  expiresAt: ts("expires_at").notNull(),
  createdAt: createdAt(),
});

export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type GoogleConnection = typeof googleConnections.$inferSelect;
