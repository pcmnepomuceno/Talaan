import { afterEach } from "vitest";

// RTL only auto-cleans with test globals on; this project keeps them off.
afterEach(async () => {
  if (typeof document === "undefined") return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
