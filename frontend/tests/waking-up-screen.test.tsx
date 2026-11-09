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
beforeEach(() => {
  vi.useFakeTimers();
  fake = installFake();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const LINE = /Starting up/;
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
  await act(async () => vi.advanceTimersByTime(WAKE_MS));
  // Two always-mounted copies: above <main> below 1280, inside the list pane from 1280 (CSS shows one).
  const lines = screen.getAllByText(LINE);
  expect(lines).toHaveLength(2);
  expect(lines.filter((p) => p.closest('section[aria-label="Applications"]'))).toHaveLength(1);
  expect(lines.filter((p) => !p.closest("main"))).toHaveLength(1);

  await act(async () => release());
  await act(async () => {});
  expect(screen.queryByText(LINE)).toBeNull();
  expect(screen.getByRole("list", { name: "Applications" })).toBeTruthy();

  slowList();
  act(() => clearCaches()); // a write elsewhere: the list reloads behind the skeleton
  await act(async () => vi.advanceTimersByTime(WAKE_MS * 2));
  expect(document.querySelector('section[aria-label="Applications"] .animate-ledger-pulse')).toBeTruthy();
  expect(screen.queryByText(LINE)).toBeNull();
});
