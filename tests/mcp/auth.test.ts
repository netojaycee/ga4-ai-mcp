import { afterEach, describe, expect, it, vi } from "vitest";
import { authenticateMcp, devStubAuthenticator } from "@/server/mcp/auth";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/mcp", { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("dev stub authenticator", () => {
  it("returns null in production even with the dev header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await devStubAuthenticator(req({ "x-dev-user-id": "abc" }))).toBeNull();
    expect(await authenticateMcp(req({ "x-dev-user-id": "abc", authorization: "Bearer x" }))).toBeNull();
  });

  it("accepts the dev header outside production", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await devStubAuthenticator(req({ "x-dev-user-id": "abc" }))).toEqual({
      userId: "abc", clientId: "dev-stub", scope: "",
    });
  });

  it("returns null without the header", async () => {
    vi.stubEnv("NODE_ENV", "development");
    expect(await devStubAuthenticator(req())).toBeNull();
    expect(await devStubAuthenticator(req({ authorization: "Bearer whatever" }))).toBeNull();
  });
});
