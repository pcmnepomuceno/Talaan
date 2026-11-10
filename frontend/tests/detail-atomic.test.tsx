// @vitest-environment jsdom
// The in-place writes on the detail (interview delete, status change) must not depend on when React
// renders: the cache entry that replaces the cleared one is set in the same synchronous step as the
// notification. This file adds an extra awaited tick after each real API call resolves; with a
// caller-side cache write after the await, React would render the clear (a skeleton) in that tick.
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake } from "./helpers/fake-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: "1" }),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/applications/1",
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const real = await importOriginal<typeof import("../src/lib/api")>();
  const tick = () => new Promise((r) => setTimeout(r, 0));
  return {
    ...real,
    deleteInterview: async (...a: Parameters<typeof real.deleteInterview>) => {
      await real.deleteInterview(...a);
      await tick();
    },
    changeStatus: async (...a: Parameters<typeof real.changeStatus>) => {
      const r = await real.changeStatus(...a);
      await tick();
      return r;
    },
  };
});

let fake: Fake;
beforeEach(() => {
  clearCaches();
  fake = installFake();
});
// The observer outlives a test that times out (RTL unmounts first): disconnect it here, and query
// without throwing inside its callback, so a timeout never turns into an unhandled error.
let observer: MutationObserver | null = null;
afterEach(() => {
  observer?.disconnect();
  observer = null;
  vi.restoreAllMocks();
});

const mount = () =>
  render(
    <ToastProvider>
      <ApplicationsScreen>
        <ApplicationDetailPage />
      </ApplicationsScreen>
    </ToastProvider>,
  );
const detailSkeleton = () => screen.queryByRole("region", { name: "Application detail" })?.querySelector(".animate-ledger-pulse");

function watchSkeleton() {
  const seen: string[] = [];
  const obs = new MutationObserver(() => {
    if (detailSkeleton()) seen.push("skeleton");
  });
  observer = obs;
  obs.observe(document.body, { subtree: true, childList: true, attributes: true });
  return { seen, stop: () => obs.disconnect() };
}

it("interview delete: an extra awaited tick after the API resolves cannot show a skeleton", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  await userEvent.click(screen.getByRole("button", { name: "Delete interview, Oct 24, 2026, 2:00 PM PHT" }));
  const w = watchSkeleton();
  await userEvent.click(await screen.findByRole("button", { name: "Delete interview" }));
  await screen.findByText("Interview deleted.");
  await waitFor(() => expect(fake.callsTo("GET", /^\/applications\/1\/interviews/).length).toBeGreaterThanOrEqual(2));
  await new Promise((r) => setTimeout(r, 30));
  w.stop();
  expect(w.seen).toEqual([]);
}, 15_000);

it("status change: an extra awaited tick after the API resolves cannot show a skeleton", async () => {
  mount();
  await screen.findByRole("list", { name: "Interviews" });
  await userEvent.click(screen.getByRole("button", { name: "Change status" }));
  await userEvent.click(screen.getByRole("radio", { name: "Applied" }));
  const w = watchSkeleton();
  await userEvent.click(screen.getByRole("button", { name: "Update status" }));
  await screen.findByText("Status updated.");
  await new Promise((r) => setTimeout(r, 30));
  w.stop();
  expect(w.seen).toEqual([]);
});
