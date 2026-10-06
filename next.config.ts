import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Opt-in for container builds (Dockerfile sets BUILD_STANDALONE=1); Vercel builds are unaffected.
  output: process.env.BUILD_STANDALONE === "1" ? "standalone" : undefined,
  async headers() {
    return [
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
