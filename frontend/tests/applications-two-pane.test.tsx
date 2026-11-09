// @vitest-environment jsdom
// A status change with the list and the detail both mounted (the 1280 two-pane layout): the list is
// patched in place from the server's row, never dropped to the skeleton or refetched (PR #23 review
// item 1). jsdom has no layout, so the scroll position is checked in scripts/e2e-applications.cjs.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches } from "../src/lib/cache";
import type { Application } from "../src/lib/types";
import { type Fake, installFake, makeApp } from "./helpers/fake-api";

let search = "";
let paramId = "1";
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => ({ id: paramId }),
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => `/applications/${paramId}`,
}));

let fake: Fake;
const install = (apps: Application[]) => (fake = installFake({ apps, interviews: [] }));
beforeEach(() => {
  clearCaches();
  search = "";
  paramId = "1";
});
afterEach(() => vi.restoreAllMocks());

const mount = () =>
  render(
    <ToastProvider>
      <ApplicationsScreen>
        <ApplicationDetailPage />
      </ApplicationsScreen>
    </ToastProvider>,
  );
const appList = () => screen.getByRole("list", { name: "Applications" });
const rowIds = () => within(appList()).getAllByRole("link").map((a) => Number(a.getAttribute("href")!.split("?")[0].split("/").pop()));
const rowOf = (id: number) => within(appList()).getAllByRole("link").find((a) => a.getAttribute("href")!.split("?")[0] === `/applications/${id}`)!;
const listGets = () => fake.callsTo("GET", /^\/applications\?/);
const detailGets = () => fake.callsTo("GET", /^\/applications\/\d+(\/|$)/);

function watchSkeletons() {
  const seen = new Set<string>();
  const look = () => {
    for (const el of document.querySelectorAll(".animate-ledger-pulse"))
      seen.add(el.closest('section[aria-label="Applications"]') ? "list skeleton" : "detail skeleton");
  };
  const obs = new MutationObserver(look);
  obs.observe(document.body, { subtree: true, childList: true, attributes: true });
  return { seen, stop: () => obs.disconnect() };
}

async function changeStatusTo(label: string) {
  await screen.findByText("No interviews yet.");
  await userEvent.click(screen.getByRole("button", { name: "Change status" }));
  await userEvent.click(screen.getByRole("radio", { name: label }));
  await userEvent.click(screen.getByRole("button", { name: "Update status" }));
  await screen.findByText("Status updated.");
}

it("All view: the row changes in place; loaded pages stay; no skeleton, no list or detail refetch, actions enabled", async () => {
  install(Array.from({ length: 120 }, (_, i) => makeApp(i + 1, { status: "applied" })));
  mount();
  await screen.findByRole("list", { name: "Applications" });
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowIds()).toHaveLength(100));
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowIds()).toHaveLength(120));
  const order = rowIds();
  const lists = listGets().length;
  const details = detailGets().length;
  const w = watchSkeletons();
  await changeStatusTo("Offered");
  await new Promise((r) => setTimeout(r, 30));
  w.stop();
  expect([...w.seen]).toEqual([]);
  expect(rowIds()).toEqual(order); // order and every loaded page kept
  expect(rowOf(1).textContent).toContain("Offered");
  expect(listGets()).toHaveLength(lists);
  expect(detailGets()).toHaveLength(details); // the PATCH response is the fresh row: no refetch
  expect((screen.getByRole("button", { name: "Change status" }) as HTMLButtonElement).disabled).toBe(false);
  expect(screen.getByRole("region", { name: "Application detail" }).getAttribute("aria-busy")).toBeNull();
});

it("filtered view: the row leaves, and the next Load more asks for the server's next unsent row (no gap)", async () => {
  install([
    ...Array.from({ length: 60 }, (_, i) => makeApp(i + 1, { status: "applied" })),
    ...Array.from({ length: 5 }, (_, i) => makeApp(i + 61, { status: "saved" })),
  ]);
  search = "status=applied";
  paramId = "60"; // the newest applied row: on page 1
  mount();
  await waitFor(() => expect(rowIds()).toHaveLength(50));
  const lists = listGets().length;
  const w = watchSkeletons();
  await changeStatusTo("Offered");
  await waitFor(() => expect(rowIds()).toHaveLength(49));
  w.stop();
  expect([...w.seen]).toEqual([]);
  expect(rowIds()).not.toContain(60);
  expect(listGets()).toHaveLength(lists);
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowIds()).toHaveLength(59));
  expect(listGets().at(-1)!.path).toContain("offset=49");
  const server = fake.db.apps.filter((a) => a.status === "applied").map((a) => a.id).sort((a, b) => b - a);
  expect(rowIds()).toEqual(server);
  expect(screen.queryByRole("button", { name: "Load more" })).toBeNull();
});

it("a fully loaded list for the new status gets the row at its sorted place, without a skeleton or refetch", async () => {
  install([makeApp(2, { status: "offered" }), makeApp(4, { status: "offered" }), makeApp(5, { status: "applied" }), makeApp(6, { status: "offered" })]);
  search = "status=offered";
  paramId = "5"; // opened by URL: not in this list
  mount();
  await waitFor(() => expect(rowIds()).toEqual([6, 4, 2]));
  const lists = listGets().length;
  const w = watchSkeletons();
  await changeStatusTo("Offered");
  await waitFor(() => expect(rowIds()).toEqual([6, 5, 4, 2]));
  w.stop();
  expect([...w.seen]).toEqual([]);
  expect(listGets()).toHaveLength(lists);
  await act(async () => {}); // nothing else lands later
  expect(rowIds()).toEqual([6, 5, 4, 2]);
});

it("a Load more in flight during a status change is dropped (its offset is stale) and offered again from the patched cursor", async () => {
  install(Array.from({ length: 60 }, (_, i) => makeApp(i + 1, { status: "applied" })));
  search = "status=applied";
  paramId = "60";
  mount();
  await waitFor(() => expect(rowIds()).toHaveLength(50));
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  const real = { ...fake.db };
  fake.on("GET", /^\/applications\?.*offset=50/, async () => {
    const rows = real.apps.filter((a) => a.status === "applied").sort((a, b) => b.id - a.id).slice(50, 100);
    await gate; // answered with the pre-change rows
    return new Response(JSON.stringify({ items: rows, total: 60, limit: 50, offset: 50 }));
  });
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await changeStatusTo("Offered");
  await act(async () => {
    release();
    await gate;
  });
  await waitFor(() => expect(screen.getByRole("button", { name: "Load more" }).textContent).toBe("Load more"));
  expect(rowIds()).toHaveLength(49); // the stale page was not appended
  await userEvent.click(screen.getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(rowIds()).toHaveLength(59));
  expect(listGets().at(-1)!.path).toContain("offset=49");
  expect(rowIds()).toEqual(fake.db.apps.filter((a) => a.status === "applied").map((a) => a.id).sort((a, b) => b - a));
});
