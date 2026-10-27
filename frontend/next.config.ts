import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false, // stop `next dev` re-generating AGENTS.md (rules live in the root CLAUDE.md)
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
