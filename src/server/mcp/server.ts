import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { brandStatic } from "@/config/brand";
import type { McpAuthContext } from "@/server/auth/context";
import { TOOLS } from "./tools";
import type { ToolDefinition } from "./tools/types";
import { runTool, type WrapperDeps } from "./wrapper";

/** Build a per-request MCP server whose tools all run through the wrapper for this caller. */
export function buildMcpServer(ctx: McpAuthContext, tools: ToolDefinition[] = TOOLS, deps?: WrapperDeps) {
  const server = new McpServer({ name: brandStatic.slug, version: "0.1.0" });
  for (const tool of tools) {
    server.registerTool(
      tool.name,
      {
        title: tool.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true },
      },
      // The SDK validates args against inputSchema before this runs.
      async (args: unknown) => runTool(tool.name, ctx, (tc) => tool.handler(args as never, tc), deps),
    );
  }
  return server;
}
