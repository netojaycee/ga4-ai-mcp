import type { McpAuthenticator } from "@/server/auth/context";
import { authenticateBearer } from "@/server/oauth/authenticate";

/**
 * DEV STUB. Never authenticates in production, and needs ALLOW_DEV_AUTH=1 elsewhere; then accepts `x-dev-user-id: <users.id>` for local testing.
 * Kept for local testing only; production uses the real OAuth bearer validation below.
 */
export const devStubAuthenticator: McpAuthenticator = async (req) => {
  // Two independent switches: never in production, and only when explicitly enabled (ALLOW_DEV_AUTH=1).
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_DEV_AUTH !== "1") return null;
  const userId = req.headers.get("x-dev-user-id")?.trim();
  if (!userId) return null;
  return { userId, clientId: "dev-stub", scope: "" };
};

/**
 * The authenticator /mcp uses: real OAuth bearer tokens first; outside production a dev header is also
 * accepted so the endpoint can be exercised without a full login.
 */
export const authenticateMcp: McpAuthenticator = async (req) =>
  (await authenticateBearer(req)) ?? (await devStubAuthenticator(req));

export default authenticateMcp;
