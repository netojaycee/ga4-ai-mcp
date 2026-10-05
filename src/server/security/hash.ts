import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** SHA-256 hex digest. Used for storing OAuth codes and tokens (never store them raw). */
export function sha256Hex(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Cryptographically random URL-safe token (default 32 bytes = 256 bits). */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PKCE S256: BASE64URL(SHA256(code_verifier)). */
export function pkceS256(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}
