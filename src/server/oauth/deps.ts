import { brand } from "@/config/brand";
import { getSessionUser, type SessionUser } from "@/server/auth/session";
import { REGISTER_LIMIT, consumeAnonLimit, pgAnonRateStore, type AnonLimitResult } from "@/server/security/anon-ratelimit";
import { randomToken } from "@/server/security/hash";
import { drizzleClientRepo, drizzleCodeRepo, drizzleTokenRepo } from "./drizzle-repo";
import type { ClientRepo, CodeRepo, TokenRepo } from "./repo";

export interface OAuthDeps {
  clients: ClientRepo;
  codes: CodeRepo;
  tokens: TokenRepo;
  getUser(req: Request): Promise<SessionUser | null>;
  /** Public base URL without trailing slash; also the issuer. */
  baseUrl: string;
  mcpUrl: string;
  brandName: string;
  now(): Date;
  random(): string;
  /** Anonymous registration throttle. Optional so unit-test fakes can omit it. */
  limitRegistration?(req: Request): Promise<AnonLimitResult>;
}

/** Built per request so env() is never read at import time. */
export function defaultDeps(): OAuthDeps {
  const b = brand();
  return {
    clients: drizzleClientRepo(),
    codes: drizzleCodeRepo(),
    tokens: drizzleTokenRepo(),
    getUser: getSessionUser,
    baseUrl: b.baseUrl,
    mcpUrl: b.mcpUrl,
    brandName: b.name,
    now: () => new Date(),
    random: () => randomToken(32),
    limitRegistration: (req) => consumeAnonLimit(pgAnonRateStore(), REGISTER_LIMIT, req, new Date()),
  };
}
