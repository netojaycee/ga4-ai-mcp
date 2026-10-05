import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { parseEnv } from "@/config/env";

const good = () => ({
  PUBLIC_BASE_URL: "https://example.com/",
  DATABASE_URL: "postgres://u:p@h/db",
  GOOGLE_CLIENT_ID: "id",
  GOOGLE_CLIENT_SECRET: "secret",
  TOKEN_ENC_KEYS: JSON.stringify({ "1": randomBytes(32).toString("base64") }),
  TOKEN_ENC_CURRENT: "1",
  SESSION_SECRET: "x".repeat(32),
  ADMIN_EMAILS: " A@x.com, b@x.com ,",
});

describe("parseEnv", () => {
  it("accepts a valid config and normalises values", () => {
    const e = parseEnv(good());
    expect(e.PUBLIC_BASE_URL).toBe("https://example.com");
    expect(e.ADMIN_EMAILS).toEqual(["a@x.com", "b@x.com"]);
    expect(e.TRIAL_DAYS).toBe(14);
    expect(e.BRAND_NAME).toBe("Insights Connector");
  });

  it("rejects a current key version that is not in the keyring", () => {
    expect(() => parseEnv({ ...good(), TOKEN_ENC_CURRENT: "2" })).toThrow(/TOKEN_ENC_CURRENT/);
  });

  it("rejects short keys, short session secrets and bad JSON", () => {
    expect(() => parseEnv({ ...good(), TOKEN_ENC_KEYS: JSON.stringify({ "1": "c2hvcnQ=" }) })).toThrow(/TOKEN_ENC_KEYS/);
    expect(() => parseEnv({ ...good(), SESSION_SECRET: "short" })).toThrow(/SESSION_SECRET/);
    expect(() => parseEnv({ ...good(), TOKEN_ENC_KEYS: "not json" })).toThrow(/TOKEN_ENC_KEYS/);
  });

  it("reports names but never values in errors", () => {
    try {
      parseEnv({ ...good(), SESSION_SECRET: "super-secret-but-short" });
      throw new Error("should have thrown");
    } catch (err) {
      expect(String(err)).toContain("SESSION_SECRET");
      expect(String(err)).not.toContain("super-secret-but-short");
    }
  });
});
