import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ session: null as { userId: string; email: string } | null, cookie: "ga_session=x" as string | null }));

vi.mock("next/headers", () => ({ headers: async () => new Headers(state.cookie ? { cookie: state.cookie } : {}) }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT:${url}`);
  },
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/config/env", () => ({ env: () => ({ ADMIN_EMAILS: ["boss@example.com"] }) }));
vi.mock("@/server/auth/session", async (orig) => ({
  ...(await orig<typeof import("@/server/auth/session")>()),
  getSessionUserFromCookieHeader: async () => state.session,
}));

import { checkAdmin, getAdminFromCookieHeader, isAdminEmail, requireAdmin } from "@/server/admin/guard";

beforeEach(() => {
  state.session = null;
  state.cookie = "ga_session=x";
});

describe("isAdminEmail", () => {
  it("is case-insensitive and trims", () => {
    expect(isAdminEmail("  BOSS@Example.com ", ["boss@example.com"])).toBe(true);
    expect(isAdminEmail("boss@example.com", ["BOSS@EXAMPLE.COM"])).toBe(true);
    expect(isAdminEmail("other@example.com", ["boss@example.com"])).toBe(false);
    expect(isAdminEmail("boss@example.com", [])).toBe(false);
  });
});

describe("checkAdmin", () => {
  it("returns logged_out, not_admin, admin", async () => {
    expect((await checkAdmin(null, async () => null, ["a@x.com"])).kind).toBe("logged_out");
    expect((await checkAdmin("c", async () => ({ userId: "1", email: "b@x.com" }), ["a@x.com"])).kind).toBe("not_admin");
    const r = await checkAdmin("c", async () => ({ userId: "1", email: "A@X.com" }), ["a@x.com"]);
    expect(r).toEqual({ kind: "admin", admin: { userId: "1", email: "A@X.com" } });
  });
});

describe("requireAdmin", () => {
  it("redirects a logged-out visitor to the sign-in start with return_to=/admin", async () => {
    await expect(requireAdmin()).rejects.toThrow("REDIRECT:/api/connect/google/start?return_to=%2Fadmin");
  });

  it("responds 404 to a signed-in non-admin", async () => {
    state.session = { userId: "u1", email: "user@example.com" };
    await expect(requireAdmin()).rejects.toThrow("NOT_FOUND");
  });

  it("returns the admin, matching email case-insensitively", async () => {
    state.session = { userId: "u1", email: "Boss@Example.COM" };
    await expect(requireAdmin()).resolves.toEqual({ userId: "u1", email: "Boss@Example.COM" });
  });

  it("getAdminFromCookieHeader returns null for non-admins and logged out", async () => {
    expect(await getAdminFromCookieHeader("x")).toBeNull();
    state.session = { userId: "u1", email: "user@example.com" };
    expect(await getAdminFromCookieHeader("x")).toBeNull();
    state.session = { userId: "u1", email: "boss@example.com" };
    expect(await getAdminFromCookieHeader("x")).toEqual({ userId: "u1", email: "boss@example.com" });
  });
});
