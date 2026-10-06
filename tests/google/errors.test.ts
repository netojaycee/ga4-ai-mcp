import { describe, expect, it } from "vitest";
import { GoogleHttpError, mapGoogleError, parseGoogleHttpError, sanitizeHint } from "@/server/google/errors";
import { ToolError } from "@/server/errors";
import { runReport } from "@/server/google/ga4";
import { fakeAuth, mockFetch } from "./helpers";

const body = (status: number, reason?: string, gStatus?: string, message = "msg") =>
  JSON.stringify({ error: { code: status, message, status: gStatus, errors: reason ? [{ reason }] : undefined } });

describe("mapGoogleError", () => {
  it.each([
    [429, undefined, undefined, "quota_exceeded"],
    [403, "rateLimitExceeded", undefined, "quota_exceeded"],
    [403, "dailyLimitExceeded", undefined, "quota_exceeded"],
    [503, undefined, "RESOURCE_EXHAUSTED", "quota_exceeded"],
    [401, undefined, undefined, "reconnect_required"],
    [403, undefined, "PERMISSION_DENIED", "permission_denied"],
    [403, "accessNotConfigured", undefined, "permission_denied"],
    [404, undefined, undefined, "not_found"],
    [400, undefined, "INVALID_ARGUMENT", "invalid_input"],
    [500, undefined, undefined, "upstream_error"],
    [503, undefined, undefined, "upstream_error"],
  ])("HTTP %s reason=%s status=%s -> %s", (status, reason, gStatus, code) => {
    const e = mapGoogleError(parseGoogleHttpError(status, body(status, reason, gStatus)));
    expect(e).toBeInstanceOf(ToolError);
    expect(e.code).toBe(code);
  });

  it("maps network failures and unknown errors to upstream_error", () => {
    expect(mapGoogleError(new TypeError("fetch failed")).code).toBe("upstream_error");
  });

  it("passes ToolErrors through untouched", () => {
    const t = new ToolError("auth_required", "x");
    expect(mapGoogleError(t)).toBe(t);
  });

  it("includes a safe hint for 400", () => {
    const e = mapGoogleError(
      parseGoogleHttpError(400, body(400, undefined, "INVALID_ARGUMENT", "Field foo is not a valid metric")),
    );
    expect(e.userMessage).toContain("Field foo is not a valid metric");
  });

  it("never leaks tokens, headers or raw bodies in userMessage", () => {
    const secret = "ya29.A0ARrdaM-" + "x".repeat(60);
    const raw = JSON.stringify({
      error: {
        code: 400,
        message: `bad Bearer ${secret} and ${secret}`,
        status: "INVALID_ARGUMENT",
        details: [{ internal: "SECRET-INTERNAL" }],
      },
    });
    const e = mapGoogleError(parseGoogleHttpError(400, raw));
    expect(e.userMessage).not.toContain(secret);
    expect(e.userMessage).not.toContain("SECRET-INTERNAL");
    expect(e.userMessage).not.toContain("ya29");
    expect(mapGoogleError(new GoogleHttpError(500)).userMessage).not.toMatch(/Bearer|authorization/i);
  });

  it("tolerates non-JSON error bodies", () => {
    expect(mapGoogleError(parseGoogleHttpError(502, "<html>Bad gateway</html>")).code).toBe("upstream_error");
  });

  it("sanitizeHint bounds length and strips long opaque strings", () => {
    expect(sanitizeHint("a ".repeat(500)).length).toBeLessThanOrEqual(240);
    expect(sanitizeHint("token abcdefghijklmnopqrstuvwxyz0123456789ABCDEF here")).toContain("[redacted]");
  });

  it("is applied end to end by the HTTP helper", async () => {
    const { fetch } = mockFetch({ status: 403, body: body(403, undefined, "PERMISSION_DENIED") });
    await expect(runReport(fakeAuth, { property: "1", metrics: ["sessions"] }, { fetch })).rejects.toMatchObject({
      code: "permission_denied",
    });
  });
});
