/**
 * Shared error type for anything a tool call can fail with. `userMessage` is written to be read by an
 * LLM and its user: say what happened and what to do next. Never include tokens or raw upstream bodies.
 */
export type ToolErrorCode =
  | "auth_required"
  | "reconnect_required"
  | "permission_denied"
  | "not_found"
  | "quota_exceeded"
  | "rate_limited"
  | "plan_blocked"
  | "invalid_input"
  | "upstream_error";

export class ToolError extends Error {
  constructor(
    readonly code: ToolErrorCode,
    readonly userMessage: string,
    options?: { cause?: unknown },
  ) {
    super(userMessage, options);
    this.name = "ToolError";
  }
}

export const isToolError = (e: unknown): e is ToolError => e instanceof ToolError;
