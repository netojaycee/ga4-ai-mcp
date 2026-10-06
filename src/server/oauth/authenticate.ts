import { brand } from "@/config/brand";
import type { McpAuthContext, McpAuthenticator } from "@/server/auth/context";
import { sha256Hex } from "@/server/security/hash";
import { sameResource } from "./config";
import { drizzleTokenRepo } from "./drizzle-repo";
import type { TokenRepo } from "./repo";

const BEARER_RE = /^Bearer +([A-Za-z0-9\-._~+/]+=*)$/i;

export function createAuthenticator(
  tokens: TokenRepo,
  mcpUrl: () => string,
  now: () => Date = () => new Date(),
): McpAuthenticator {
  return async (req: Request): Promise<McpAuthContext | null> => {
    const m = BEARER_RE.exec(req.headers.get("authorization") ?? "");
    if (!m) return null;
    const record = await tokens.find(sha256Hex(m[1]));
    if (!record || record.kind !== "access" || record.revokedAt) return null;
    if (record.expiresAt.getTime() <= now().getTime()) return null;
    if (!sameResource(record.resource, mcpUrl())) return null;
    return { userId: record.userId, clientId: record.clientId, scope: record.scope };
  };
}

/** Validates our own opaque access tokens on /mcp. Never accepts anything issued elsewhere. */
export const authenticateBearer: McpAuthenticator = (req) =>
  createAuthenticator(drizzleTokenRepo(), () => brand().mcpUrl)(req);
