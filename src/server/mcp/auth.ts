import type { McpAuthenticator } from "@/server/auth/context";

/**
 * DEV STUB. Never authenticates in production; elsewhere accepts `x-dev-user-id: <users.id>` for local testing.
 * The OAuth work (task 4.7) replaces this: change the one `authenticateMcp` export below.
 */
export const devStubAuthenticator: McpAuthenticator = async (req) => {
  if (process.env.NODE_ENV === "production") return null;
  const userId = req.headers.get("x-dev-user-id")?.trim();
  if (!userId) return null;
  return { userId, clientId: "dev-stub", scope: "" };
};

/** The authenticator /mcp uses. Swap this single line for the real token validator. */
export const authenticateMcp: McpAuthenticator = devStubAuthenticator;

export default authenticateMcp;
