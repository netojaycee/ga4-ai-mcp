import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { McpAuthenticator } from "@/server/auth/context";
import { buildMcpServer } from "./server";
import type { ToolDefinition } from "./tools/types";
import type { WrapperDeps } from "./wrapper";

export interface McpHandlerOptions {
  authenticate: McpAuthenticator;
  /** Lazy so importing never needs env. Returns PUBLIC_BASE_URL without trailing slash. */
  publicBaseUrl: () => string;
  tools?: ToolDefinition[];
  wrapperDeps?: WrapperDeps;
}

// Bearer tokens only (no cookies), so a wildcard origin is safe and lets browser-based clients connect.
const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Accept, Mcp-Session-Id, Mcp-Protocol-Version, Last-Event-ID",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
  "Access-Control-Max-Age": "86400",
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

/** Stateless Streamable HTTP: a fresh server and transport per request, JSON responses. */
export function createMcpHandler(opts: McpHandlerOptions) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    let ctx;
    try {
      ctx = await opts.authenticate(req);
    } catch {
      console.error("[mcp] authenticator failed");
      return withCors(Response.json({ error: "server_error" }, { status: 500 }));
    }
    if (!ctx) {
      return withCors(
        Response.json(
          { error: "unauthorized", error_description: "A valid access token is required." },
          {
            status: 401,
            headers: {
              "WWW-Authenticate": `Bearer resource_metadata="${opts.publicBaseUrl()}/.well-known/oauth-protected-resource"`,
            },
          },
        ),
      );
    }

    const server = buildMcpServer(ctx, opts.tools, opts.wrapperDeps);
    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });
    await server.connect(transport);
    return withCors(await transport.handleRequest(req));
  };
}
