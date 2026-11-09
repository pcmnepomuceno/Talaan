import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false, // stop `next dev` re-generating AGENTS.md (rules live in the root CLAUDE.md)
  // HIDE_DEV_INDICATOR=1 npm run dev: the indicator overlaps the nav in screenshots.
  ...(process.env.HIDE_DEV_INDICATOR ? { devIndicators: false as const } : {}),
  // /api/* is forwarded to the backend by src/proxy.ts (it has to add headers; rewrites() cannot).
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
