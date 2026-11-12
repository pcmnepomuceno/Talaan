import { availableParallelism } from "node:os";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// DOM tests opt in with `// @vitest-environment jsdom`; the rest stay on node.
// `@` mirrors the tsconfig path so app screens (which use it) can be imported in tests.
// maxWorkers: Vitest 5's default is CPUs - 1 in a normal run and half the CPUs in watch mode
// (getDefaultMaxWorkers in vitest/dist). On a 32-thread machine that is 31 jsdom files importing
// React at once; they starve each other (a file that takes 1.5 s alone took 6 to 25 s) and the
// heavier tests blew the 5 s test timeout at random (measured 2026-11-11: 3 of 12 full runs with
// 3 more test files, 1 of 12 before them; with 8 workers 0 of 12, and the median run 13 s instead of
// 16 s). So: the normal-run default, capped at 8; a longer timeout would only hide the contention.
// Up to 9 CPUs (a 4-vCPU CI runner gets 3) a normal run is unchanged; watch mode gets CPUs - 1 too.
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { maxWorkers: Math.min(8, Math.max(1, availableParallelism() - 1)), environment: "node", include: ["tests/**/*.test.{ts,tsx}"], setupFiles: ["tests/setup.ts"] },
});
