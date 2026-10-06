/**
 * Same-origin relative paths only. Anything else (absolute URLs, `//host`, backslashes, schemes,
 * control characters) falls back to `fallback`.
 */
export function sanitizeReturnTo(raw: string | null | undefined, fallback = "/account"): string {
  if (!raw || raw.length > 2048) return fallback;
  if (!raw.startsWith("/") || raw.startsWith("//")) return fallback;
  if (/[\\\u0000-\u001f\u007f]/.test(raw)) return fallback;
  let decoded = raw;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  // Defend against encoded `//` or `\` that some clients normalise after decoding.
  if (decoded.startsWith("//") || /[\\\u0000-\u001f\u007f]/.test(decoded)) return fallback;
  // Final check: must resolve to our own origin.
  try {
    const u = new URL(raw, "http://internal.invalid");
    if (u.origin !== "http://internal.invalid") return fallback;
  } catch {
    return fallback;
  }
  return raw;
}
