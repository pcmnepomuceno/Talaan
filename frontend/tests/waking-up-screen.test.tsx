// @vitest-environment jsdom
// DESIGN.md 6.12 on the applications screen: the slow-start line is for the first load only, when
// there is nothing to show yet, never for a reload after a cache clear (PR #23 review item 5).
import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationsPage from "../src/app/(app)/applications/(ledger)/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { WAKE_MS } from "../src/components/waking-up";
import { clearCaches } from "../src/lib/cache";
import { type Fake, installFake, json } from "./helpers/fake-api";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(""),
  usePathname: () => "/applications",
}));

let fake: Fake;
// Only setTimeout is faked (the WakingUp clock). Faking everything (setImmediate included) let the fake
// fetch's Response body stall under CPU load, so the test hung until its 5 s timeout.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  fake = installFake();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LINE = /Starting up/;
/** Lets real I/O callbacks and fake timers run until `done()` holds (bounded). */
async function until(done: () => boolean) {
  for (let i = 0; i < 200 && !done(); i++) {
    await act(async () => {
      await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(10);
    });
  }
  expect(done()).toBe(true);
}
function slowList() {
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const page = { items: fake.db.apps, total: fake.db.apps.length, limit: 50, offset: 0 };
  fake.on("GET", /^\/applications\?/, async () => (await gate, json(200, page)));
  return release;
}

it("shows after 3 s on the first load only; a reload after a cache clear never shows it", async () => {
  const release = slowList();
  render(
    <ToastProvider>
      <ApplicationsScreen>
        <ApplicationsPage />
      </ApplicationsScreen>
    </ToastProvider>,
  );
  await act(() => vi.advanceTimersByTimeAsync(WAKE_MS));
  // Two always-mounted copies: above <main> below 1280, inside the list pane from 1280 (CSS shows one).
  const lines = screen.getAllByText(LINE);
  expect(lines).toHaveLength(2);
  expect(lines.filter((p) => p.closest('section[aria-label="Applications"]'))).toHaveLength(1);
  expect(lines.filter((p) => !p.closest("main"))).toHaveLength(1);

  await act(async () => release());
  await until(() => !!document.querySelector('ul[aria-label="Applications"]'));
  expect(screen.queryByText(LINE)).toBeNull();
  expect(screen.getByRole("list", { name: "Applications" })).toBeTruthy();

  slowList();
  act(() => clearCaches()); // a write elsewhere: the list reloads behind the skeleton
  await act(() => vi.advanceTimersByTimeAsync(WAKE_MS * 2));
  expect(document.querySelector('section[aria-label="Applications"] .animate-ledger-pulse')).toBeTruthy();
  expect(screen.queryByText(LINE)).toBeNull();
}, 15_000);
