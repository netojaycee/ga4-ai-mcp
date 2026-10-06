export const NO_STORE = { "Cache-Control": "no-store", Pragma: "no-cache" } as const;

export const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, MCP-Protocol-Version",
  "Access-Control-Max-Age": "86400",
} as const;

export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS });
}

export function jsonResponse(status: number, body: unknown, extra: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...extra },
  });
}

export function oauthError(status: number, error: string, description: string): Response {
  return jsonResponse(status, { error, error_description: description }, { ...NO_STORE, ...CORS });
}

/** Reads a size-capped body; null when too large. */
export async function readCappedText(req: Request, maxBytes: number): Promise<string | null> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (declared > maxBytes) return null;
  const text = await req.text();
  return Buffer.byteLength(text) > maxBytes ? null : text;
}
