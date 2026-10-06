import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt-in for container builds (Dockerfile sets BUILD_STANDALONE=1); Vercel builds are unaffected.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  async headers() {
    return [
      {
        // Baseline for every response. Referrer-Policy is deliberately NOT set globally: the OAuth consent page
        // needs `same-origin` (see src/server/oauth/html.ts) and must not be overridden.
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
          { key: "Strict-Transport-Security", value: "max-age=63072000" },
        ],
      },
      {
        source: "/admin/:path*",
        headers: [
          { key: "Cache-Control", value: "no-store" },
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
        ],
      },
    ];
  },
};

export default nextConfig;
