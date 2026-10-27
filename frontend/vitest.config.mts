import { defineConfig } from "vitest/config";

// DOM tests opt in with `// @vitest-environment jsdom`; the rest stay on node.
export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"] },
});
