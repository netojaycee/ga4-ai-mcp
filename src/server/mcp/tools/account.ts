import { eq } from "drizzle-orm";
import { db } from "@/server/db/client";
import { googleConnections } from "@/server/db/schema";
import { trialDaysLeft } from "@/server/plans/entitlements";
import { dailyRemaining, pgRateLimitStore, type RateLimitStore } from "@/server/security/ratelimit";
import { defineTool, type ToolDefinition } from "./types";

export interface AccountDeps {
  rateStore: () => RateLimitStore;
  googleEmail: (userId: string) => Promise<{ email: string; status: string } | null>;
}

const defaultDeps: AccountDeps = {
  rateStore: pgRateLimitStore,
  async googleEmail(userId) {
    const rows = await db()
      .select({ email: googleConnections.googleEmail, status: googleConnections.status })
      .from(googleConnections)
      .where(eq(googleConnections.userId, userId))
      .limit(1);
    return rows[0] ?? null;
  },
};

export function createAccountStatusTool(deps: AccountDeps = defaultDeps): ToolDefinition {
  return defineTool({
    name: "account_status",
    title: "Account status",
    description:
      "Show the current user's plan, trial days left, remaining tool calls for today (UTC) and the connected Google account. Use it to explain limits or to check the Google connection before running reports.",
    inputSchema: {},
    async handler(_args, { user, limits, now }) {
      const remaining = await dailyRemaining(deps.rateStore(), user.id, limits, now);
      const google = await deps.googleEmail(user.id);
      const days = trialDaysLeft(user, now);
      const status = {
        plan: user.plan,
        trialDaysLeft: days,
        dailyCallsRemaining: remaining,
        dailyCallLimit: limits.dailyCalls,
        googleEmail: google?.email ?? null,
        googleConnectionStatus: google?.status ?? "not_connected",
      };
      const lines = [
        `Plan: ${status.plan}`,
        ...(days !== null ? [`Trial days left: ${days}`] : []),
        `Tool calls remaining today (UTC): ${remaining} of ${limits.dailyCalls}`,
        google ? `Google account: ${google.email} (${google.status})` : "Google account: not connected",
      ];
      return { text: lines.join("\n"), structured: status };
    },
  });
}

export const accountStatusTool = createAccountStatusTool();
