import { env } from "@/config/env";
import { createMcpHandler } from "@/server/mcp/handler";
import { authenticateMcp } from "@/server/mcp/auth";
import { MCP_AUTH_FAIL_LIMIT, consumeAnonLimit, pgAnonRateStore } from "@/server/security/anon-ratelimit";

export const dynamic = "force-dynamic";

const handler = createMcpHandler({
  authenticate: authenticateMcp,
  publicBaseUrl: () => env().PUBLIC_BASE_URL,
  limitUnauthenticated: (req) => consumeAnonLimit(pgAnonRateStore(), MCP_AUTH_FAIL_LIMIT, req, new Date()),
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
