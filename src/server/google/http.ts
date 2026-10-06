import { mapGoogleError, parseGoogleHttpError } from "./errors";
import type { GoogleAuth } from "./auth";

export type FetchLike = typeof fetch;

/** Options every data-layer call accepts. `maxRows` is the caller's plan limit and only ever lowers caps. */
export interface CallOptions {
  maxRows?: number;
  fetch?: FetchLike;
  /** Injectable clock for relative-date defaults. */
  now?: () => Date;
}

const TIMEOUT_MS = 25_000;

/** Authenticated JSON request. Throws a ToolError (never a raw upstream error or body). */
export async function googleJson(
  auth: GoogleAuth,
  url: string,
  init: { method?: "GET" | "POST"; body?: unknown; fetch?: FetchLike } = {},
): Promise<unknown> {
  try {
    const token = await auth.getAccessToken();
    const res = await (init.fetch ?? fetch)(url, {
      method: init.method ?? "GET",
      headers: {
        authorization: `Bearer ${token}`,
        accept: "application/json",
        ...(init.body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw parseGoogleHttpError(res.status, await res.text().catch(() => ""));
    return await res.json();
  } catch (e) {
    throw mapGoogleError(e);
  }
}

export function capLimit(requested: number, hardCap: number, maxRows?: number): number {
  const planCap = maxRows !== undefined && maxRows > 0 ? Math.floor(maxRows) : Infinity;
  return Math.max(1, Math.min(requested, hardCap, planCap));
}
