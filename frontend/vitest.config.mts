import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DOM tests opt in with `// @vitest-environment jsdom`; the rest stay on node.
// `@` mirrors the tsconfig path so app screens (which use it) can be imported in tests.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { environment: "node", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"] },
});
