import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DOM tests opt in with `// @vitest-environment jsdom`; the rest stay on node.
// `@` mirrors the tsconfig path so app screens (which use it) can be imported in tests.
// maxWorkers: vitest defaults to one worker per core. On a 32-thread machine that is 31 jsdom files
// importing React at once; they starve each other (a file that takes 1.5 s alone took 6 to 25 s) and
// the heavier tests blew the 5 s test timeout at random (measured 2026-11-11: 3 of 12 full runs with
// 3 more test files, 1 of 12 before them; with 8 workers 0 of 12, and the median run 13 s instead of
// 16 s). Capped, not a longer timeout. Machines with fewer than 8 cores (CI) keep the default.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { maxWorkers: Math.min(8, availableParallelism()), environment: "node", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"] },
});
