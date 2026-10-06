import type { User } from "@/server/db/schema";
import type { WrapperDeps, UsageRecord } from "@/server/mcp/wrapper";
import type { RateLimitStore } from "@/server/security/ratelimit";

export function fakeStore(): RateLimitStore {
  const map = new Map<string, number>();
  return {
    async increment(u, k) {
      const v = (map.get(`${u}|${k}`) ?? 0) + 1;
      map.set(`${u}|${k}`, v);
      return v;
    },
    async get(u, k) {
      return map.get(`${u}|${k}`) ?? 0;
    },
  };
}

export const NOW = new Date("2026-10-06T12:00:00Z");

export function makeUser(over: Partial<User> = {}): User {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    email: "u@example.com",
    googleSub: "sub",
    name: null,
    plan: "paid",
    trialEndsAt: null,
    notes: null,
    createdAt: NOW,
    lastSeenAt: null,
    ...over,
  };
}

export function makeDeps(user: User | null, over: Partial<WrapperDeps> = {}) {
  const usage: UsageRecord[] = [];
  const deps: WrapperDeps = {
    loadUser: async () => user,
    rateStore: fakeStore(),
    logUsage: async (r) => {
      usage.push(r);
    },
    now: () => NOW,
    ...over,
  };
  return { deps, usage };
}

export const ctx = { userId: "00000000-0000-4000-8000-000000000001", clientId: "client-1", scope: "" };
