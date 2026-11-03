import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false, // stop `next dev` re-generating AGENTS.md (rules live in the root CLAUDE.md)
  // HIDE_DEV_INDICATOR=1 npm run dev: the indicator overlaps the nav in screenshots.
  ...(process.env.HIDE_DEV_INDICATOR ? { devIndicators: false as const } : {}),
  // The browser only talks to the Next origin; /api/* is forwarded to the backend, so the session
  // cookie is first-party and no CORS is needed. BACKEND_URL is read at build time (Vercel: set it
  // in the project env before deploying).
  async rewrites() {
    const backend = (process.env.BACKEND_URL ?? "http://localhost:8000").replace(/\/+$/, "");
    return [{ source: "/api/:path*", destination: `${backend}/api/:path*` }];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
