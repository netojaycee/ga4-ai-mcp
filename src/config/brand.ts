import { env } from "@/config/env";

/**
 * Single source of brand strings. Rename the product by changing env (BRAND_NAME,
 * PUBLIC_BASE_URL, MAIL_FROM) and the constants below; no other file hard-codes a name.
 */
export const brandStatic = {
  slug: "insights-connector",
  tagline: "Connect your AI assistant to Google Analytics 4 and Search Console.",
  privacyPath: "/privacy",
  termsPath: "/terms",
  mcpPath: "/mcp",
} as const;

/** For static contexts (metadata) where full env validation must not run at build time. */
export const brandNameFallback = () => process.env.BRAND_NAME?.trim() || "Insights Connector";

export function brand() {
  const e = env();
  return {
    ...brandStatic,
    name: e.BRAND_NAME,
    baseUrl: e.PUBLIC_BASE_URL,
    mcpUrl: `${e.PUBLIC_BASE_URL}${brandStatic.mcpPath}`,
    privacyUrl: `${e.PUBLIC_BASE_URL}${brandStatic.privacyPath}`,
    termsUrl: `${e.PUBLIC_BASE_URL}${brandStatic.termsPath}`,
    mailFrom: e.MAIL_FROM,
    supportEmail: e.SUPPORT_EMAIL,
  };
}
