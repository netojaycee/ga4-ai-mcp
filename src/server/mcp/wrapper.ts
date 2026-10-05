import { eq } from "drizzle-orm";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { PlanLimits } from "@/config/plans";
import type { McpAuthContext } from "@/server/auth/context";
import { db } from "@/server/db/client";
import { usageEvents, users, type User } from "@/server/db/schema";
import { ToolError, isToolError, type ToolErrorCode } from "@/server/errors";
import { checkEntitlement } from "@/server/plans/entitlements";
import { consumeRateLimit, pgRateLimitStore, type RateLimitStore } from "@/server/security/ratelimit";

export interface ToolContext {
  ctx: McpAuthContext;
  user: User;
  limits: PlanLimits;
  now: Date;
}

export interface ToolOutput {
  /** Text shown to the model. */
  text: string;
  structured?: Record<string, unknown>;
  /** Property or site identifier only, for usage logging. Never query contents. */
  target?: string;
  /** Number of data rows returned, for usage logging. */
  rows?: number;
}

export interface UsageRecord {
  userId: string | null;
  clientId: string;
  tool: string;
  target: string | null;
  ok: boolean;
  errorCode: string | null;
  latencyMs: number;
  rows: number | null;
}

export interface WrapperDeps {
  loadUser(userId: string): Promise<User | null>;
  rateStore: RateLimitStore;
  logUsage(record: UsageRecord): Promise<void>;
  now(): Date;
}

export function defaultWrapperDeps(): WrapperDeps {
  return {
    async loadUser(userId) {
      const rows = await db().select().from(users).where(eq(users.id, userId)).limit(1);
      return rows[0] ?? null;
    },
    rateStore: pgRateLimitStore(),
    async logUsage(r) {
      await db().insert(usageEvents).values(r);
    },
    now: () => new Date(),
  };
}

const errorResult = (message: string): CallToolResult => ({
  isError: true,
  content: [{ type: "text", text: message }],
});

/**
 * Every tool call goes through here: user -> entitlement -> rate/quota -> handler -> error map -> usage log.
 * Authentication already happened at the HTTP layer and produced `ctx`.
 */
export async function runTool(
  name: string,
  ctx: McpAuthContext,
  handler: (tc: ToolContext) => Promise<ToolOutput>,
  deps: WrapperDeps = defaultWrapperDeps(),
): Promise<CallToolResult> {
  const started = Date.now();
  let userId: string | null = null;
  let target: string | null = null;
  let rows: number | null = null;
  let errorCode: ToolErrorCode | null = null;
  let result: CallToolResult;

  try {
    const user = await deps.loadUser(ctx.userId);
    if (!user) throw new ToolError("auth_required", "Your account was not found. Please reconnect the connector.");
    userId = user.id;
    const now = deps.now();
    const { limits } = checkEntitlement(user, now);
    await consumeRateLimit(deps.rateStore, user.id, limits, now);

    const out = await handler({ ctx, user, limits, now });
    target = out.target ?? null;
    rows = out.rows ?? null;
    result = { content: [{ type: "text", text: out.text }] };
    if (out.structured) result.structuredContent = out.structured;
  } catch (e) {
    if (isToolError(e)) {
      errorCode = e.code;
      result = errorResult(e.userMessage);
    } else {
      errorCode = "upstream_error";
      // Name only: unexpected error messages may carry upstream details.
      console.error(`[mcp] tool ${name} failed unexpectedly: ${e instanceof Error ? e.name : typeof e}`);
      result = errorResult("Something went wrong while running this tool. Please try again in a moment.");
    }
  }

  try {
    await deps.logUsage({
      userId,
      clientId: ctx.clientId,
      tool: name,
      target,
      ok: errorCode === null,
      errorCode,
      latencyMs: Date.now() - started,
      rows,
    });
  } catch {
    console.error(`[mcp] usage log failed for tool ${name}`);
  }
  return result;
}
