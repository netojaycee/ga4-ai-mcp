import { env } from "@/config/env";
import { createMcpHandler } from "@/server/mcp/handler";
import { authenticateMcp } from "@/server/mcp/auth";

export const dynamic = "force-dynamic";

const handler = createMcpHandler({
  authenticate: authenticateMcp,
  publicBaseUrl: () => env().PUBLIC_BASE_URL,
});

export const GET = handler;
export const POST = handler;
export const DELETE = handler;
export const OPTIONS = handler;
