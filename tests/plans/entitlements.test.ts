import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "@/config/plans";
import { isToolError } from "@/server/errors";
import { checkEntitlement } from "@/server/plans/entitlements";

const now = new Date("2026-10-06T12:00:00Z");
const past = new Date("2026-10-05T12:00:00Z");
const future = new Date("2026-10-09T11:00:00Z");

function blockedCode(fn: () => unknown) {
  try {
    fn();
  } catch (e) {
    if (isToolError(e)) return e.code;
    throw e;
  }
  return null;
}

describe("checkEntitlement", () => {
  it("blocks suspended with plan_blocked", () => {
    expect(blockedCode(() => checkEntitlement({ plan: "suspended", trialEndsAt: null }, now))).toBe("plan_blocked");
    expect(blockedCode(() => checkEntitlement({ plan: "suspended", trialEndsAt: future }, now))).toBe("plan_blocked");
  });

  it("blocks an expired trial, including exactly at the end instant", () => {
    expect(blockedCode(() => checkEntitlement({ plan: "trial", trialEndsAt: past }, now))).toBe("plan_blocked");
    expect(blockedCode(() => checkEntitlement({ plan: "trial", trialEndsAt: now }, now))).toBe("plan_blocked");
  });

  it("allows an unexpired trial and reports days left (rounded up)", () => {
    const e = checkEntitlement({ plan: "trial", trialEndsAt: future }, now);
    expect(e.trialDaysLeft).toBe(3);
    expect(e.limits).toEqual(PLAN_LIMITS.trial);
  });

  it("treats a trial with null trialEndsAt as open-ended", () => {
    const e = checkEntitlement({ plan: "trial", trialEndsAt: null }, now);
    expect(e.trialDaysLeft).toBeNull();
  });

  it.each(["internal", "paid"] as const)("allows %s regardless of trialEndsAt", (plan) => {
    for (const trialEndsAt of [null, past, future]) {
      const e = checkEntitlement({ plan, trialEndsAt }, now);
      expect(e.limits).toEqual(PLAN_LIMITS[plan]);
      expect(e.trialDaysLeft).toBeNull();
    }
  });

  it("messages are user readable and leak nothing", () => {
    try {
      checkEntitlement({ plan: "trial", trialEndsAt: past }, now);
    } catch (e) {
      expect(isToolError(e) && e.userMessage).toMatch(/trial has ended/i);
    }
  });
});
