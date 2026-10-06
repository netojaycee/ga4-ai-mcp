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
const req = (ip: string) => new Request("https://x.test/oauth/register", { headers: { "x-forwarded-for": `${ip}` } });
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

  it("on a trusted platform (Vercel) uses x-real-ip, then the forwarded address", () => {
    const r = new Request("https://x.test", { headers: { "x-real-ip": "9.9.9.9", "x-forwarded-for": "1.1.1.1" } });
    expect(clientIp(r, { trustRealIp: true })).toBe("9.9.9.9");
    expect(clientIp(req("1.1.1.1"), { trustRealIp: true })).toBe("1.1.1.1");
  });

  it("elsewhere ignores client-settable x-real-ip and the spoofable left side of x-forwarded-for", () => {
    const spoof = new Request("https://x.test", { headers: { "x-real-ip": "6.6.6.6", "x-forwarded-for": "7.7.7.7, 8.8.8.8, 203.0.113.5" } });
    expect(clientIp(spoof, { trustRealIp: false })).toBe("203.0.113.5"); // the hop our own proxy appended
    expect(clientIp(new Request("https://x.test"), { trustRealIp: false })).toBe("unknown");
  });

  it("a spoofer rotating the left side of x-forwarded-for stays in ONE bucket", async () => {
    const s = memoryStore();
    const attempts = ["1.0.0.1", "1.0.0.2", "1.0.0.3", "1.0.0.4"].map(
      (spoofed) => new Request("https://x.test", { headers: { "x-forwarded-for": `${spoofed}, 203.0.113.5` } }),
    );
    const results = [];
    for (const a of attempts) results.push((await consumeAnonLimit(s, rule, a, now, { trustRealIp: false })).allowed);
    expect(results).toEqual([true, true, true, false]); // per-IP limit of 3 holds
  });

  it("denied attempts do not drain the global budget (no lockout of other callers)", async () => {
    const s = memoryStore();
    for (let i = 0; i < 50; i++) await consumeAnonLimit(s, rule, req("9.9.9.9"), now); // one abusive source
    // global cap is 5/day and only 3 of the 50 were allowed, so other callers still get through
    expect((await consumeAnonLimit(s, rule, req("2.2.2.2"), now)).allowed).toBe(true);
    expect((await consumeAnonLimit(s, rule, req("3.3.3.3"), now)).allowed).toBe(true);
  });
});
