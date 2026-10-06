import { z } from "zod";
import { ToolError } from "@/server/errors";

/**
 * Raw failure from a Google REST call. `message` is deliberately generic: the upstream body is parsed into
 * the structured fields below and then discarded, so it can never leak into logs or tool output by accident.
 */
export class GoogleHttpError extends Error {
  constructor(
    readonly status: number,
    readonly reason?: string,
    readonly googleStatus?: string,
    /** Sanitised, length-limited upstream message. Only surfaced for 400s as a hint. */
    readonly hint?: string,
  ) {
    super(`Google API request failed with HTTP ${status}`);
    this.name = "GoogleHttpError";
  }
}

const errorBody = z.object({
  error: z
    .object({
      message: z.string().optional(),
      status: z.string().optional(),
      errors: z.array(z.object({ reason: z.string().optional() }).loose()).optional(),
      details: z.array(z.object({ reason: z.string().optional() }).loose()).optional(),
    })
    .loose()
    .optional(),
});

/** Strip anything token-like and bound the length before an upstream message is shown to anyone. */
export function sanitizeHint(message: string): string {
  return message
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/Bearer\s+\S+/gi, "[redacted]")
    .replace(/[A-Za-z0-9_\-./+=]{32,}/g, "[redacted]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 240);
}

/** Build a GoogleHttpError from a failed response's status and (untrusted) body text. */
export function parseGoogleHttpError(status: number, bodyText: string): GoogleHttpError {
  let json: unknown;
  try {
    json = JSON.parse(bodyText);
  } catch {
    return new GoogleHttpError(status);
  }
  const parsed = errorBody.safeParse(json);
  const e = parsed.success ? parsed.data.error : undefined;
  const reason = e?.errors?.find((x) => x.reason)?.reason ?? e?.details?.find((d) => d.reason)?.reason;
  return new GoogleHttpError(status, reason, e?.status, e?.message ? sanitizeHint(e.message) : undefined);
}

const QUOTA_REASONS = new Set([
  "ratelimitexceeded",
  "userratelimitexceeded",
  "quotaexceeded",
  "dailylimitexceeded",
  "rate_limit_exceeded",
  "resource_exhausted",
]);

const NOT_ENABLED_REASONS = new Set(["accessnotconfigured", "service_disabled", "api_not_enabled"]);

export function mapGoogleError(err: unknown): ToolError {
  if (err instanceof ToolError) return err;

  if (err instanceof GoogleHttpError) {
    const reason = err.reason?.toLowerCase();
    const gStatus = err.googleStatus?.toLowerCase();
    const cause = { cause: err };

    if (err.status === 429 || (reason && QUOTA_REASONS.has(reason)) || gStatus === "resource_exhausted") {
      return new ToolError(
        "quota_exceeded",
        "Google rejected the request because an API quota or rate limit was reached. Wait a minute and retry, or ask for a smaller report (fewer dimensions, a shorter date range, a lower row limit).",
        cause,
      );
    }
    if (err.status === 401) {
      return new ToolError(
        "reconnect_required",
        "Google no longer accepts the saved connection for this account. Ask the user to reconnect their Google account, then try again.",
        cause,
      );
    }
    if (err.status === 403) {
      if (reason && NOT_ENABLED_REASONS.has(reason)) {
        return new ToolError(
          "permission_denied",
          "A required Google API is not enabled for this service. This is a server configuration problem; the user cannot fix it by reconnecting. Report it to the service owner.",
          cause,
        );
      }
      return new ToolError(
        "permission_denied",
        "The connected Google account does not have access to that property or site (or it was not granted the read-only scope). Check the property or site identifier with the list tools, or reconnect with an account that has access.",
        cause,
      );
    }
    if (err.status === 404) {
      return new ToolError(
        "not_found",
        "Google could not find that property, site, URL or resource. Use the list tools to find valid identifiers and check the spelling (for Search Console, the site URL must match exactly, e.g. https://example.com/ or sc-domain:example.com).",
        cause,
      );
    }
    if (err.status === 400) {
      const hint = err.hint ? ` Google said: "${err.hint}".` : "";
      return new ToolError(
        "invalid_input",
        `Google rejected the request as invalid.${hint} Check dimension, metric and filter names (ga4_get_metadata lists valid ones for GA4), date formats and that the combination of fields is allowed.`,
        cause,
      );
    }
    return new ToolError(
      "upstream_error",
      "Google returned an unexpected error. This is usually temporary; try again shortly.",
      cause,
    );
  }

  return new ToolError(
    "upstream_error",
    "The request to Google failed (network problem or timeout). This is usually temporary; try again shortly.",
    { cause: err },
  );
}
