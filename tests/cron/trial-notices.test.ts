import { describe, expect, it } from "vitest";
import {
  checkCronAuth,
  classifyTrialUsers,
  runTrialNotices,
  type NoticeDeps,
  type TrialUser,
} from "@/server/mail/trial-notices";
import type { SendResult } from "@/server/mail/resend";

const NOW = new Date("2026-10-06T09:00:00Z");
const day = 86_400_000;
const u = (id: string, offsetDays: number): TrialUser => ({
  id,
  email: `${id}@x.com`,
  trialEndsAt: new Date(NOW.getTime() + offsetDays * day),
});
const brand = { name: "B", baseUrl: "https://b.test", mcpUrl: "https://b.test/mcp", privacyUrl: "https://b.test/privacy" };

function deps(users: TrialUser[], opts: { sent?: string[]; send?: (to: string) => SendResult } = {}) {
  const recorded: string[] = [];
  const mails: string[] = [];
  const d: NoticeDeps = {
    now: () => NOW,
    brand,
    listTrialUsers: async () => users,
    alreadySent: async () => new Set(opts.sent ?? []),
    recordSent: async (id, kind) => void recorded.push(`${id}:${kind}`),
    send: async (m) => {
      mails.push(m.to);
      return opts.send?.(m.to) ?? { ok: true, id: "1" };
    },
  };
  return { d, recorded, mails };
}

describe("checkCronAuth", () => {
  const secret = "s".repeat(20);
  it("rejects when the secret is not configured, even with a matching-looking header", () => {
    expect(checkCronAuth("Bearer ", undefined)).toBe("unconfigured");
    expect(checkCronAuth(`Bearer ${secret}`, undefined)).toBe("unconfigured");
    expect(checkCronAuth(`Bearer ${secret}`, "")).toBe("unconfigured");
  });
  it("rejects missing, malformed and wrong credentials", () => {
    expect(checkCronAuth(null, secret)).toBe("unauthorized");
    expect(checkCronAuth(secret, secret)).toBe("unauthorized");
    expect(checkCronAuth("Bearer wrong", secret)).toBe("unauthorized");
    expect(checkCronAuth(`Bearer ${secret}x`, secret)).toBe("unauthorized");
  });
  it("accepts the right bearer", () => {
    expect(checkCronAuth(`Bearer ${secret}`, secret)).toBe("ok");
  });
});

describe("classifyTrialUsers", () => {
  it("selects ending within 3 days and ended within 7 days", () => {
    const rows = [u("soon", 2.9), u("edge3", 3), u("far", 3.1), u("now", -0.1), u("old6", -6.9), u("old7", -7), u("old8", -8)];
    const got = classifyTrialUsers(rows, NOW).map((c) => `${c.user.id}:${c.kind}`);
    expect(got).toEqual(["soon:ending_soon", "edge3:ending_soon", "now:ended", "old6:ended"]);
  });
});

describe("runTrialNotices", () => {
  it("sends once per kind and records each send", async () => {
    const { d, recorded, mails } = deps([u("a", 2), u("b", -1)]);
    const s = await runTrialNotices(d);
    expect(mails.sort()).toEqual(["a@x.com", "b@x.com"]);
    expect(recorded.sort()).toEqual(["a:ending_soon", "b:ended"]);
    expect(s).toMatchObject({ ending_soon: { sent: 1 }, ended: { sent: 1 }, stoppedEarly: false });
  });

  it("is idempotent: users already recorded for that kind are skipped, other kinds still send", async () => {
    const { d, mails } = deps([u("a", 2), u("b", -1)], { sent: ["a:ending_soon"] });
    const s = await runTrialNotices(d);
    expect(mails).toEqual(["b@x.com"]);
    expect(s.ending_soon).toEqual({ sent: 0, skipped: 1, failed: 0 });
    expect(s.ended.sent).toBe(1);
  });

  it("does not record failed sends and stops on rate limit", async () => {
    const many = Array.from({ length: 25 }, (_, i) => u(`u${i}`, 1));
    const { d, recorded, mails } = deps(many, { send: () => ({ ok: false, reason: "rate_limited", status: 429 }) });
    const s = await runTrialNotices(d);
    expect(recorded).toEqual([]);
    expect(mails).toHaveLength(10); // one batch, then stop
    expect(s).toMatchObject({ stoppedEarly: true, stopReason: "rate_limited", ending_soon: { failed: 10 } });
  });

  it("returns counts only (no addresses or ids)", async () => {
    const { d } = deps([u("secretid", 1)]);
    const json = JSON.stringify(await runTrialNotices(d));
    expect(json).not.toContain("secretid");
    expect(json).not.toContain("@");
  });

  it("does nothing when there are no candidates", async () => {
    const { d, mails } = deps([u("far", 10)]);
    expect(await runTrialNotices(d)).toMatchObject({ ending_soon: { sent: 0 }, ended: { sent: 0 } });
    expect(mails).toEqual([]);
  });
});
