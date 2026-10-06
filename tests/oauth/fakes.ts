import { createHash } from "node:crypto";
import type { OAuthDeps } from "@/server/oauth/deps";
import type { AuthCode, OAuthClient, TokenRecord } from "@/server/oauth/repo";
import { sha256Hex } from "@/server/security/hash";

export const BASE = "https://app.example.test";
export const MCP = `${BASE}/mcp`;
export const REDIRECT = "https://client.example.com/cb";
export const USER = { userId: "11111111-1111-1111-1111-111111111111", email: "u@example.com" };

export const VERIFIER = "v".repeat(50);
export const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

export interface Harness {
  deps: OAuthDeps;
  clients: Map<string, OAuthClient>;
  codes: Map<string, AuthCode>;
  tokens: Map<string, TokenRecord>;
  clock: { now: Date };
  session: { user: typeof USER | null };
}

export function makeHarness(): Harness {
  const clients = new Map<string, OAuthClient>();
  const codes = new Map<string, AuthCode>();
  const tokens = new Map<string, TokenRecord>();
  const clock = { now: new Date("2026-10-06T12:00:00Z") };
  const session: { user: typeof USER | null } = { user: USER };
  let n = 0;
  const deps: OAuthDeps = {
    clients: {
      async create(c) {
        clients.set(c.clientId, c);
      },
      async find(id) {
        return clients.get(id) ?? null;
      },
    },
    codes: {
      async insert(c) {
        codes.set(c.codeHash, c);
      },
      async find(h) {
        return codes.get(h) ?? null;
      },
      async markUsed(h, at) {
        const c = codes.get(h);
        if (!c || c.usedAt) return false;
        c.usedAt = at;
        return true;
      },
    },
    tokens: {
      async insert(t) {
        tokens.set(t.tokenHash, t);
      },
      async find(h) {
        return tokens.get(h) ?? null;
      },
      async findChildren(ps) {
        return [...tokens.values()].filter((t) => t.parentHash && ps.includes(t.parentHash));
      },
      async revokeIfActive(h, at) {
        const t = tokens.get(h);
        if (!t || t.revokedAt) return false;
        t.revokedAt = at;
        return true;
      },
      async revokeMany(hs, at) {
        for (const h of hs) {
          const t = tokens.get(h);
          if (t && !t.revokedAt) t.revokedAt = at;
        }
      },
    },
    getUser: async () => session.user,
    baseUrl: BASE,
    mcpUrl: MCP,
    brandName: "TestBrand",
    now: () => clock.now,
    random: () => `rnd${++n}_${"x".repeat(40)}`,
  };
  return { deps, clients, codes, tokens, clock, session };
}

export function addClient(h: Harness, overrides: Partial<OAuthClient> = {}): OAuthClient {
  const c: OAuthClient = {
    clientId: "client-1",
    clientName: "Test Client",
    redirectUris: [REDIRECT],
    tokenEndpointAuthMethod: "none",
    ...overrides,
  };
  h.clients.set(c.clientId, c);
  return c;
}

export function authorizeUrl(extra: Record<string, string | null> = {}): string {
  const p: Record<string, string | null> = {
    client_id: "client-1",
    redirect_uri: REDIRECT,
    response_type: "code",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
    state: "st123",
    resource: MCP,
    ...extra,
  };
  const u = new URL(`${BASE}/oauth/authorize`);
  for (const [k, v] of Object.entries(p)) if (v !== null) u.searchParams.set(k, v);
  return u.toString();
}

export function formReq(url: string, fields: Record<string, string>, headers: Record<string, string> = {}): Request {
  return new Request(url, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
    body: new URLSearchParams(fields).toString(),
  });
}

export const hashOf = sha256Hex;
