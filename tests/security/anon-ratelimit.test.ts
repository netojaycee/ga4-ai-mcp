import { describe, expect, it } from "vitest";
import { consumeAnonLimit, clientIp, type AnonRateStore } from "@/server/security/anon-ratelimit";

function memoryStore(): AnonRateStore & { keys: string[] } {
  const m = new Map<string, number>();
  return {
    keys: [],
    async increment(b, w) {
      const k = `${b}|${w}`;
      this.keys.push(k);
      m.set(k, (m.get(k) ?? 0) + 1);
      return m.get(k)!;
    },
  };
}
const rule = { name: "register", perIpPerHour: 3, globalPerDay: 5 };
const req = (ip: string) => new Request("https://x.test/oauth/register", { headers: { "x-forwarded-for": `${ip}, 10.0.0.1` } });
const now = new Date("2026-10-06T12:30:00Z");

describe("anonymous rate limit", () => {
  it("allows up to the per-IP hourly limit, then blocks with a retry time", async () => {
    const s = memoryStore();
    for (let i = 0; i < 3; i++) expect((await consumeAnonLimit(s, rule, req("1.1.1.1"), now)).allowed).toBe(true);
    const blocked = await consumeAnonLimit(s, rule, req("1.1.1.1"), now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(1800);
  });

  it("limits IPs independently, resets next hour, and enforces the global daily cap", async () => {
    const s = memoryStore();
    for (let i = 0; i < 3; i++) await consumeAnonLimit(s, rule, req("1.1.1.1"), now);
    expect((await consumeAnonLimit(s, rule, req("2.2.2.2"), now)).allowed).toBe(true); // 4th overall
    expect((await consumeAnonLimit(s, rule, req("1.1.1.1"), new Date("2026-10-06T13:00:00Z"))).allowed).toBe(true); // 5th, new hour
    const capped = await consumeAnonLimit(s, rule, req("3.3.3.3"), now); // 6th overall > 5
    expect(capped.allowed).toBe(false);
    expect(capped.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("never stores raw IPs", async () => {
    const s = memoryStore();
    await consumeAnonLimit(s, rule, req("203.0.113.9"), now);
    expect(s.keys.join(" ")).not.toContain("203.0.113.9");
  });

  it("prefers x-real-ip, falls back to the first forwarded address, then 'unknown'", () => {
    expect(clientIp(new Request("https://x.test", { headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" } }))).toBe("9.9.9.9");
    expect(clientIp(req("1.1.1.1"))).toBe("1.1.1.1");
    expect(clientIp(new Request("https://x.test"))).toBe("unknown");
  });
});
