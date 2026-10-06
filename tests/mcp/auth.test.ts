import { afterEach, describe, expect, it, vi } from "vitest";

// The real validator needs Postgres; here it stands in as "no valid bearer token".
vi.mock("@/server/oauth/authenticate", () => ({ authenticateBearer: vi.fn(async () => null) }));

import { authenticateMcp, devStubAuthenticator } from "@/server/mcp/auth";
import { authenticateBearer } from "@/server/oauth/authenticate";

const req = (headers: Record<string, string> = {}) => new Request("http://localhost/mcp", { method: "POST", headers });

afterEach(() => vi.unstubAllEnvs());

describe("dev stub authenticator", () => {
  it("returns null in production even with the dev header", async () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(await devStubAuthenticator(req({ "x-dev-user-id": "abc" }))).toBeNull();
    expect(await authenticateMcp(req({ "x-dev-user-id": "abc", authorization: "Bearer x" }))).toBeNull();
  });

  it("prefers a valid OAuth bearer over the dev header, and the dev header never works in production", async () => {
    vi.mocked(authenticateBearer).mockResolvedValueOnce({ userId: "real", clientId: "c", scope: "analytics:read" });
    expect(await authenticateMcp(req({ authorization: "Bearer good", "x-dev-user-id": "abc" }))).toMatchObject({ userId: "real" });
    vi.stubEnv("NODE_ENV", "development");
    expect(await authenticateMcp(req({ "x-dev-user-id": "abc" }))).toMatchObject({ clientId: "dev-stub" });
    vi.stubEnv("NODE_ENV", "production");
    expect(await authenticateMcp(req({ "x-dev-user-id": "abc" }))).toBeNull();
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
