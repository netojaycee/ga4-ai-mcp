import { createHmac } from "node:crypto";
import { safeEqual } from "@/server/security/hash";

/** `base64url(json).base64url(hmac-sha256)`. Payloads carry their own `exp` (unix seconds). */
export function signPayload(payload: Record<string, unknown>, secret: string): string {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${mac(body, secret)}`;
}

export function verifyPayload<T extends { exp: number }>(
  token: string | undefined | null,
  secret: string,
  nowSeconds: number,
): T | null {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  if (!safeEqual(sig, mac(body, secret))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as T;
    if (typeof payload?.exp !== "number" || payload.exp <= nowSeconds) return null;
    return payload;
  } catch {
    return null;
  }
}

export function mac(data: string, secret: string): string {
  return createHmac("sha256", secret).update(data).digest("base64url");
}

export function readCookie(header: string | null | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim();
  }
  return undefined;
}

export interface CookieOptions {
  maxAgeSeconds: number;
  path?: string;
  secure: boolean;
}

export function serializeCookie(name: string, value: string, o: CookieOptions): string {
  return [
    `${name}=${value}`,
    `Path=${o.path ?? "/"}`,
    `Max-Age=${o.maxAgeSeconds}`,
    "HttpOnly",
    "SameSite=Lax",
    ...(o.secure ? ["Secure"] : []),
  ].join("; ");
}

export const isProduction = () => process.env.NODE_ENV === "production";
