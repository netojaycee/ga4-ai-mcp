import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/config/env";

/** Map of key version -> base64 of 32 random bytes. */
export type Keyring = Record<string, string>;

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function keyFor(keys: Keyring, version: string): Buffer {
  const raw = keys[version];
  if (!raw) throw new Error(`Unknown encryption key version: ${version}`);
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) throw new Error(`Encryption key version ${version} is not 32 bytes`);
  return key;
}

/**
 * Output format: `v<version>.<iv>.<ciphertext>.<tag>` (base64url segments).
 * The version prefix is bound in as AAD so it cannot be swapped without detection.
 */
export function encrypt(plaintext: string, keys: Keyring, currentVersion: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, keyFor(keys, currentVersion), iv, { authTagLength: TAG_BYTES });
  cipher.setAAD(Buffer.from(`v${currentVersion}`));
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [`v${currentVersion}`, iv.toString("base64url"), ct.toString("base64url"), tag.toString("base64url")].join(".");
}

export function decrypt(payload: string, keys: Keyring): string {
  const parts = payload.split(".");
  if (parts.length !== 4 || !/^v\d+$/.test(parts[0])) throw new Error("Malformed encrypted payload");
  const [versionTag, ivB64, ctB64, tagB64] = parts;
  const iv = Buffer.from(ivB64, "base64url");
  const tag = Buffer.from(tagB64, "base64url");
  if (iv.length !== IV_BYTES || tag.length !== TAG_BYTES) throw new Error("Malformed encrypted payload");
  const decipher = createDecipheriv(ALGO, keyFor(keys, versionTag.slice(1)), iv, { authTagLength: TAG_BYTES });
  decipher.setAAD(Buffer.from(versionTag));
  decipher.setAuthTag(tag);
  try {
    return Buffer.concat([decipher.update(Buffer.from(ctB64, "base64url")), decipher.final()]).toString("utf8");
  } catch {
    // Do not leak whether it was a wrong key or tampering.
    throw new Error("Decryption failed");
  }
}

export function payloadVersion(payload: string): string {
  const m = /^v(\d+)\./.exec(payload);
  if (!m) throw new Error("Malformed encrypted payload");
  return m[1];
}

/** Convenience wrappers bound to the app's configured keyring. */
export const encryptSecret = (plaintext: string) =>
  encrypt(plaintext, env().TOKEN_ENC_KEYS, env().TOKEN_ENC_CURRENT);
export const decryptSecret = (payload: string) => decrypt(payload, env().TOKEN_ENC_KEYS);
export const needsReencryption = (payload: string) => payloadVersion(payload) !== env().TOKEN_ENC_CURRENT;
