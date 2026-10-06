import { brand } from "@/config/brand";
import { CORS, corsPreflight, jsonResponse } from "@/server/oauth/http";
import { protectedResourceMetadata } from "@/server/oauth/metadata";

/** Serves both /.well-known/oauth-protected-resource and the path-suffixed form for /mcp (RFC 9728). */
export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  const b = brand();
  const suffix = path.join("/");
  if (suffix !== "" && `/${suffix}` !== new URL(b.mcpUrl).pathname) {
    return jsonResponse(404, { error: "not_found" }, CORS);
  }
  return jsonResponse(200, protectedResourceMetadata(b.baseUrl, b.mcpUrl), {
    "Cache-Control": "public, max-age=300",
    ...CORS,
  });
}

export const OPTIONS = () => corsPreflight();
