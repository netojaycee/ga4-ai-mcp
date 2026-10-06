import { PLAN_LIMITS, type Plan, type PlanLimits } from "@/config/plans";
import { ToolError } from "@/server/errors";

export interface EntitlementUser {
  plan: Plan;
  trialEndsAt: Date | null;
}

export interface Entitlement {
  plan: Plan;
  limits: PlanLimits;
  /** Whole days left (rounded up) on a trial with an end date; null otherwise. */
  trialDaysLeft: number | null;
}

const DAY_MS = 86_400_000;

export function trialDaysLeft(user: EntitlementUser, now: Date): number | null {
  if (user.plan !== "trial" || !user.trialEndsAt) return null;
  return Math.max(0, Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / DAY_MS));
}

/**
 * Pure plan gate. A trial with no end date is treated as open-ended (admin can clear the date);
 * new users always get one from TRIAL_DAYS at creation.
 */
export function checkEntitlement(user: EntitlementUser, now: Date): Entitlement {
  switch (user.plan) {
    case "suspended":
      throw new ToolError(
        "plan_blocked",
        "This account is suspended, so tool calls are disabled. Please contact the service administrator.",
      );
    case "trial":
      if (user.trialEndsAt && user.trialEndsAt.getTime() <= now.getTime()) {
        throw new ToolError(
          "plan_blocked",
          "Your free trial has ended. Please contact the service administrator to continue using this connector.",
        );
      }
      break;
    case "internal":
    case "paid":
      break;
    default:
      throw new ToolError("plan_blocked", "This account's plan does not allow tool calls.");
  }
  return { plan: user.plan, limits: PLAN_LIMITS[user.plan], trialDaysLeft: trialDaysLeft(user, now) };
}
