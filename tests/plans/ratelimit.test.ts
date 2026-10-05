import { describe, expect, it } from "vitest";
import { isToolError } from "@/server/errors";
import {
  consumeRateLimit,
  dailyRemaining,
  dayKey,
  minuteKey,
  type RateLimitStore,
} from "@/server/security/ratelimit";

export function fakeStore(): RateLimitStore & { map: Map<string, number> } {
  const map = new Map<string, number>();
  return {
    map,
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

const limits = { perMinute: 3, dailyCalls: 5 };
const t = (iso: string) => new Date(iso);

async function message(p: Promise<void>) {
  try {
    await p;
  } catch (e) {
    if (isToolError(e)) return `${e.code}: ${e.userMessage}`;
    throw e;
  }
  return null;
}

describe("window keys", () => {
  it("uses ISO minute and UTC date", () => {
    expect(minuteKey(t("2026-10-06T12:34:56Z"))).toBe("m:2026-10-06T12:34");
    expect(dayKey(t("2026-10-06T23:59:59Z"))).toBe("d:2026-10-06");
  });
});

describe("consumeRateLimit", () => {
  it("allows up to the per-minute limit then rate_limits with a wait time", async () => {
    const s = fakeStore();
    const now = t("2026-10-06T12:00:40Z");
    for (let i = 0; i < 3; i++) expect(await message(consumeRateLimit(s, "u", limits, now))).toBeNull();
    const msg = await message(consumeRateLimit(s, "u", limits, now));
    expect(msg).toMatch(/^rate_limited: .*3 tool calls per minute.*20 seconds/);
  });

  it("resets in the next minute", async () => {
    const s = fakeStore();
    for (let i = 0; i < 3; i++) await consumeRateLimit(s, "u", limits, t("2026-10-06T12:00:10Z"));
    expect(await message(consumeRateLimit(s, "u", limits, t("2026-10-06T12:01:00Z")))).toBeNull();
  });

  it("enforces the daily limit across minutes and says when it resets", async () => {
    const s = fakeStore();
    for (let i = 0; i < 5; i++) {
      await consumeRateLimit(s, "u", limits, t(`2026-10-06T12:0${i}:00Z`));
    }
    const msg = await message(consumeRateLimit(s, "u", limits, t("2026-10-06T21:00:00Z")));
    expect(msg).toMatch(/^rate_limited: .*5 tool calls per day.*00:00 UTC.*3 hours/);
  });

  it("resets on the next UTC day", async () => {
    const s = fakeStore();
    for (let i = 0; i < 5; i++) await consumeRateLimit(s, "u", limits, t(`2026-10-06T12:0${i}:00Z`));
    expect(await message(consumeRateLimit(s, "u", limits, t("2026-10-07T00:00:00Z")))).toBeNull();
  });

  it("counts users independently", async () => {
    const s = fakeStore();
    for (let i = 0; i < 3; i++) await consumeRateLimit(s, "a", limits, t("2026-10-06T12:00:00Z"));
    expect(await message(consumeRateLimit(s, "b", limits, t("2026-10-06T12:00:00Z")))).toBeNull();
  });

  it("a zero limit blocks everything", async () => {
    expect(await message(consumeRateLimit(fakeStore(), "u", { perMinute: 0, dailyCalls: 0 }, new Date()))).toMatch(
      /^rate_limited/,
    );
  });
});

describe("dailyRemaining", () => {
  it("reports remaining without consuming", async () => {
    const s = fakeStore();
    const now = t("2026-10-06T12:00:00Z");
    await consumeRateLimit(s, "u", limits, now);
    expect(await dailyRemaining(s, "u", limits, now)).toBe(4);
    expect(await dailyRemaining(s, "u", limits, now)).toBe(4);
  });
});
