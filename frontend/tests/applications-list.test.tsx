// @vitest-environment jsdom
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import { STATUSES } from "../src/lib/types";
import { type Fake, installFake, json, makeApp } from "./helpers/fake-api";

let search = "";
const replace = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace }),
  useParams: () => ({}),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications",
}));

let fake: Fake;
beforeEach(() => {
  clearCaches();
  search = "";
  replace.mockClear();
});
afterEach(() => vi.restoreAllMocks());

const setup = (count: number, make: (id: number) => Partial<ReturnType<typeof makeApp>> = () => ({})) => {
  fake = installFake({ apps: Array.from({ length: count }, (_, i) => makeApp(i + 1, make(i + 1))), interviews: [] });
};
const mount = () =>
  render(
    <ToastProvider>
      <ApplicationsScreen>{null}</ApplicationsScreen>
    </ToastProvider>,
  );
const rowLinks = () => within(screen.getByRole("list", { name: "Applications" })).getAllByRole("link");
const status = () => screen.getAllByRole("status")[0];

it("first request is one page of 50 and shows Load more with 120 rows", async () => {
  setup(120);
  mount();
  await screen.findByRole("list", { name: "Applications" });
  expect(rowLinks()).toHaveLength(50);
  expect(fake.calls[0].path).toBe("/applications?limit=50&offset=0");
  expect(screen.getByRole("button", { name: "Load more" })).toBeTruthy();
});

it("Load more appends the next page, announces it, focuses the first new row; hidden at the end", async () => {
  setup(120);
  mount();
  await screen.findByRole("list", { name: "Applications" });
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowLinks()).toHaveLength(100));
  expect(fake.calls.at(-1)!.path).toBe("/applications?limit=50&offset=50");
  expect(status().textContent).toBe("50 more applications loaded");
  // newest first: ids 120..71 on page 1, so the first new row is id 70
  expect(document.activeElement).toBe(rowLinks()[50]);
  expect(rowLinks()[50].getAttribute("href")).toBe("/applications/70");
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowLinks()).toHaveLength(120));
  expect(status().textContent).toBe("20 more applications loaded");
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("de-duplicates by id when a row shifts between pages", async () => {
  setup(60);
  mount();
  await screen.findByRole("list", { name: "Applications" });
  // A newer row appears on the server: page 2 now repeats the last row of page 1.
  fake.db.apps.push(makeApp(61));
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowLinks().length).toBeGreaterThan(50));
  const hrefs = rowLinks().map((l) => l.getAttribute("href"));
  expect(new Set(hrefs).size).toBe(hrefs.length);
  expect(rowLinks()).toHaveLength(60);
});

it("a Load more failure keeps the loaded rows and offers a retry that works", async () => {
  setup(80);
  mount();
  await screen.findByRole("list", { name: "Applications" });
  fake.failNext("GET", /offset=50/);
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  const alert = (await screen.findByText("Couldn't load more applications.")).closest<HTMLElement>('[role="alert"]')!;
  expect(rowLinks()).toHaveLength(50);
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  await waitFor(() => expect(rowLinks()).toHaveLength(80));
  expect(screen.queryByText("Couldn't load more applications.")).toBeNull();
});

it("a double click on Load more sends one request", async () => {
  setup(120);
  mount();
  await screen.findByRole("list", { name: "Applications" });
  const btn = screen.getByRole("button", { name: "Load more" });
  await act(async () => {
    btn.click();
    btn.click();
  });
  await waitFor(() => expect(rowLinks()).toHaveLength(100));
  expect(fake.callsTo("GET", /offset=50/)).toHaveLength(1);
});

it.each(STATUSES)("tab %s requests the server filter and shows only that status", async (s) => {
  setup(9, (id) => ({ status: STATUSES[id - 1] }));
  search = `status=${s}`;
  mount();
  await screen.findByRole("list", { name: "Applications" });
  expect(rowLinks()).toHaveLength(1);
  expect(fake.calls[0].path).toBe(`/applications?limit=50&offset=0&status=${s}`);
});

it("empty versus no-match come from total and the active tab", async () => {
  setup(0);
  mount();
  expect(await screen.findByText("No applications yet.")).toBeTruthy();
  expect(screen.queryByText("No applications with this status.")).toBeNull();
  expect(fake.calls).toHaveLength(1); // no second request to learn an overall total
});

it("a status tab with no rows is no-match even when other statuses exist", async () => {
  setup(3);
  search = "status=ghosted";
  mount();
  expect(await screen.findByText("No applications with this status.")).toBeTruthy();
  expect(screen.queryByText("No applications yet.")).toBeNull();
  expect(fake.calls).toHaveLength(1);
});

it("Add links carry ?status=", async () => {
  setup(0);
  search = "status=applied";
  mount();
  await screen.findByText("No applications with this status.");
  expect(screen.getAllByRole("link", { name: "Add application" })[0].getAttribute("href")).toBe("/applications/new?status=applied");
});

it("a cached tab shows at once while page 1 refetches, then the fresh rows replace it", async () => {
  setup(3);
  const first = mount();
  await screen.findByRole("list", { name: "Applications" });
  first.unmount();
  fake.db.apps.push(makeApp(4));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  fake.on("GET", /^\/applications\?/, async () => {
    await gate;
    return json(200, { items: [...fake.db.apps].reverse(), total: 4, limit: 50, offset: 0 });
  });
  mount();
  expect(rowLinks()).toHaveLength(3); // stale rows, no skeleton
  expect(status().textContent).toBe("");
  release();
  await waitFor(() => expect(rowLinks()).toHaveLength(4));
});

it("a failed background refresh keeps the cached rows and says so", async () => {
  setup(3);
  const first = mount();
  await screen.findByRole("list", { name: "Applications" });
  first.unmount();
  fake.failNext("GET", /^\/applications\?/);
  mount();
  expect(await screen.findByText("Couldn't refresh the list. Showing the last loaded rows.")).toBeTruthy();
  expect(rowLinks()).toHaveLength(3);
});

it("a first-load failure shows Retry, and Retry recovers", async () => {
  setup(3);
  fake.failNext("GET", /^\/applications\?/);
  mount();
  const alert = (await screen.findByText("Couldn't load applications.")).closest<HTMLElement>('[role="alert"]')!;
  await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));
  expect(await screen.findByRole("list", { name: "Applications" })).toBeTruthy();
});

it("clearing the caches (a write) empties every tab and refetches the current one", async () => {
  setup(3);
  mount();
  await screen.findByRole("list", { name: "Applications" });
  fake.db.apps.push(makeApp(4));
  act(() => clearCaches());
  await waitFor(() => expect(rowLinks()).toHaveLength(4));
  expect(fake.callsTo("GET", /^\/applications\?/)).toHaveLength(2);
});

it("a response that arrives after a cache clear does not repopulate the cache", async () => {
  setup(3);
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const stale = { items: [makeApp(1)], total: 1, limit: 50, offset: 0 };
  fake.on("GET", /^\/applications\?/, async () => (await gate, json(200, stale)));
  mount();
  act(() => clearCaches()); // a write happened while the first request was in flight
  release();
  await waitFor(() => expect(rowLinks()).toHaveLength(3)); // the refetch, not the stale 1-row page
});

it("Load more is disabled while a cached tab is refreshing", async () => {
  setup(80);
  const first = mount();
  await screen.findByRole("list", { name: "Applications" });
  first.unmount();
  fake.on("GET", /^\/applications\?/, () => new Promise<Response>(() => {}));
  mount();
  expect((screen.getByRole("button", { name: "Load more" }) as HTMLButtonElement).disabled).toBe(true);
});

it("the persistent status region says Loading applications while loading", async () => {
  setup(3);
  mount();
  expect(status().textContent).toBe("Loading applications");
  await screen.findByRole("list", { name: "Applications" });
  expect(status().textContent).toBe("");
});
