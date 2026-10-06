import { vi } from "vitest";
import type { GoogleAuth } from "@/server/google/auth";

export const fakeAuth: GoogleAuth = { getAccessToken: async () => "test-access-token" };

export interface Call {
  url: string;
  method: string;
  body: Record<string, unknown> | undefined;
  headers: Record<string, string>;
}

type Resp = { status?: number; body: unknown };

export function mockFetch(responses: Resp[] | Resp) {
  const queue = Array.isArray(responses) ? [...responses] : [responses];
  const calls: Call[] = [];
  const fn = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({
      url: String(url),
      method: init?.method ?? "GET",
      body: init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    });
    const r = queue.length > 1 ? queue.shift()! : queue[0];
    return new Response(typeof r.body === "string" ? r.body : JSON.stringify(r.body), { status: r.status ?? 200 });
  });
  return { fetch: fn as unknown as typeof fetch, calls };
}
