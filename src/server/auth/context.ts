/**
 * Contract between the MCP endpoint (src/server/mcp) and the OAuth server (src/server/oauth).
 * The MCP side depends only on this; the OAuth side provides the real implementation.
 */
export interface McpAuthContext {
  userId: string;
  clientId: string;
  scope: string;
}

/**
 * Validates the bearer token on an incoming /mcp request.
 * Returns null when the token is missing, unknown, expired, revoked or has the wrong audience;
 * the endpoint then answers 401 with a WWW-Authenticate header pointing at the resource metadata.
 */
export type McpAuthenticator = (req: Request) => Promise<McpAuthContext | null>;
