import { describe, expect, it } from "vitest";
import { sanitizeReturnTo } from "@/server/connect/returnTo";

describe("sanitizeReturnTo", () => {
  it("keeps same-origin relative paths with query", () => {
    expect(sanitizeReturnTo("/oauth/authorize?client_id=a&state=b")).toBe("/oauth/authorize?client_id=a&state=b");
    expect(sanitizeReturnTo("/account")).toBe("/account");
  });

  it.each([
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/x",
    "javascript:alert(1)",
    "/\\evil.com",
    "\\\\evil.com",
    "/%2F/evil.com",
    "/%5Cevil.com",
    "/path\nhttp://evil",
    "/\t/evil.com",
    "evil.com",
    "",
    "relative/path",
    "/%zz",
    "/" + "a".repeat(3000),
  ])("rejects %j", (bad) => {
    expect(sanitizeReturnTo(bad)).toBe("/account");
  });

  it("handles null/undefined and custom fallback", () => {
    expect(sanitizeReturnTo(null)).toBe("/account");
    expect(sanitizeReturnTo(undefined, "/x")).toBe("/x");
  });
});
