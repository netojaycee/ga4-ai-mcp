import { brand } from "@/config/brand";
import { CORS, corsPreflight, jsonResponse } from "@/server/oauth/http";
import { authorizationServerMetadata } from "@/server/oauth/metadata";

/** The issuer has no path component, so only the root URL is valid (RFC 8414 3.1). */
export async function GET(_req: Request, ctx: { params: Promise<{ path?: string[] }> }) {
  const { path = [] } = await ctx.params;
  if (path.length > 0) return jsonResponse(404, { error: "not_found" }, CORS);
  return jsonResponse(200, authorizationServerMetadata(brand().baseUrl), {
    "Cache-Control": "public, max-age=300",
    ...CORS,
  });
}

export const OPTIONS = () => corsPreflight();
