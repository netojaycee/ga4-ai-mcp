export const PLANS = ["internal", "trial", "paid", "suspended"] as const;
export type Plan = (typeof PLANS)[number];

export interface PlanLimits {
  /** Tool calls allowed per rolling UTC day. 0 blocks all calls. */
  dailyCalls: number;
  /** Tool calls allowed per minute. */
  perMinute: number;
  /** Maximum rows any single report call may return. */
  maxRowsPerCall: number;
}

/** Pricing and limits are data: change them here, not in call sites. */
export const PLAN_LIMITS: Record<Plan, PlanLimits> = {
  internal: { dailyCalls: 5000, perMinute: 60, maxRowsPerCall: 10_000 },
  trial: { dailyCalls: 200, perMinute: 20, maxRowsPerCall: 1_000 },
  paid: { dailyCalls: 2000, perMinute: 40, maxRowsPerCall: 10_000 },
  suspended: { dailyCalls: 0, perMinute: 0, maxRowsPerCall: 0 },
};

export const DEFAULT_PLAN_FOR_NEW_USERS: Plan = "trial";

export function isPlan(value: string): value is Plan {
  return (PLANS as readonly string[]).includes(value);
}
