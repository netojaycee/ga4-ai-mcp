import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { decrypt, encrypt, payloadVersion } from "@/server/security/crypto";

const key = () => randomBytes(32).toString("base64");
const keys = { "1": key(), "2": key() };

describe("crypto (AES-256-GCM)", () => {
  it("round-trips, including unicode", () => {
    const secret = "1//refresh-token-ü-✓";
    expect(decrypt(encrypt(secret, keys, "1"), keys)).toBe(secret);
  });

  it("never reuses an IV and never leaks plaintext", () => {
    const a = encrypt("same", keys, "1");
    const b = encrypt("same", keys, "1");
    expect(a).not.toBe(b);
    expect(a).not.toContain("same");
  });

  it("detects tampering in any segment", () => {
    const parts = encrypt("secret", keys, "1").split(".");
    for (const i of [1, 2, 3]) {
      const t = [...parts];
      t[i] = t[i].slice(0, -2) + (t[i].endsWith("A") ? "BB" : "AA");
      expect(() => decrypt(t.join("."), keys)).toThrow();
    }
  });

  it("rejects a swapped version prefix (bound as AAD)", () => {
    const parts = encrypt("secret", { "1": keys["1"], "2": keys["1"] }, "1").split(".");
    parts[0] = "v2"; // same key material under both versions, so only AAD can catch this
    expect(() => decrypt(parts.join("."), { "1": keys["1"], "2": keys["1"] })).toThrow("Decryption failed");
  });

  it("fails with the wrong key without revealing why", () => {
    const payload = encrypt("secret", keys, "1");
    expect(() => decrypt(payload, { "1": key() })).toThrow("Decryption failed");
  });

  it("supports rotation: old versions still decrypt, new writes use the current version", () => {
    const old = encrypt("secret", keys, "1");
    expect(payloadVersion(old)).toBe("1");
    expect(decrypt(old, keys)).toBe("secret");
    const fresh = encrypt(decrypt(old, keys), keys, "2");
    expect(payloadVersion(fresh)).toBe("2");
  });

  it("rejects unknown versions and malformed payloads", () => {
    expect(() => encrypt("x", keys, "9")).toThrow("Unknown encryption key version");
    expect(() => decrypt("v9.a.b.c", keys)).toThrow();
    expect(() => decrypt("garbage", keys)).toThrow("Malformed");
    expect(() => decrypt("v1.a.b", keys)).toThrow("Malformed");
  });
});
