import { describe, expect, it } from "vitest";
import { RETENTION, runCleanup, type CleanupStore } from "@/server/maintenance/cleanup";

function recorder() {
  const calls: Record<string, unknown[]> = {};
  const rec = (name: string, n: number) => async (...args: unknown[]) => {
    calls[name] = args;
    return n;
  };
  const store: CleanupStore = {
    deleteUnusedClients: rec("clients", 1),
    deleteDeadTokens: rec("tokens", 2),
    deleteDeadAuthCodes: rec("codes", 3),
    deleteOldUsageEvents: rec("usage", 4),
    deleteOldRateCounters: rec("rate", 5),
    deleteOldAnonCounters: rec("anon", 6),
  };
  return { store, calls };
}
const now = new Date("2026-10-06T12:34:56Z");

describe("runCleanup", () => {
  it("computes retention cutoffs and returns counts only", async () => {
    const { store, calls } = recorder();
    const s = await runCleanup(store, now);
    expect(s).toEqual({ unusedClients: 1, deadTokens: 2, deadAuthCodes: 3, usageEvents: 4, rateCounters: 5, anonCounters: 6 });
    expect((calls.usage[0] as Date).toISOString()).toBe("2026-07-08T12:34:56.000Z"); // 90 days
    expect((calls.tokens[0] as Date).toISOString()).toBe("2026-09-06T12:34:56.000Z"); // 30 days
    expect((calls.clients[0] as Date).toISOString()).toBe("2026-09-29T12:34:56.000Z"); // 7 days
    expect((calls.codes[0] as Date).toISOString()).toBe("2026-10-05T12:34:56.000Z"); // 1 day
    expect(calls.rate).toEqual(["m:2026-10-04T12:34", "d:2026-09-29"]);
    expect(calls.anon).toEqual(["h:2026-10-04T12", "d:2026-09-29"]);
  });

  it("deletes tokens before clients so freshly orphaned clients go on the next run", async () => {
    const order: string[] = [];
    const mk = (n: string) => async () => (order.push(n), 0);
    await runCleanup(
      {
        deleteUnusedClients: mk("clients"), deleteDeadTokens: mk("tokens"), deleteDeadAuthCodes: mk("codes"),
        deleteOldUsageEvents: mk("usage"), deleteOldRateCounters: mk("rate"), deleteOldAnonCounters: mk("anon"),
      },
      now,
    );
    expect(order.indexOf("tokens")).toBeLessThan(order.indexOf("clients"));
    expect(order.indexOf("codes")).toBeLessThan(order.indexOf("clients"));
  });

  it("keeps the documented retention windows", () => {
    expect(RETENTION.usageEventsDays).toBe(90);
    expect(RETENTION.unusedClientDays).toBeGreaterThanOrEqual(1);
  });
});
