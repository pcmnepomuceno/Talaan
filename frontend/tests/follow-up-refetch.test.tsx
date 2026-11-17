// @vitest-environment jsdom
// The follow-up list after an interview write or a status change (PR #29 review items 5 and 6): the
// cached rows stay on screen (marked stale, never patched) while page 1 is asked again, the server's
// answer replaces them, and another list's first load is not restarted by the write.
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import ApplicationDetailPage from "../src/app/(app)/applications/(ledger)/[id]/page";
import { ApplicationsScreen } from "../src/app/(app)/applications/(ledger)/screen";
import { ToastProvider } from "../src/components/toast";
import { clearCaches, clearDetail, getList, listStale, replaceDetail, storeApplication } from "../src/lib/cache";
import { type Fake, installFake, json, makeApp } from "./helpers/fake-api";

let search = "";
let params: { id?: string } = {};
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
  useParams: () => params,
  useSearchParams: () => new URLSearchParams(search),
  usePathname: () => "/applications",
}));

let fake: Fake;
let rows: number[]; // the follow-up ids the fake server holds now, newest first
let held: { offset: number; release: (status?: number) => void }[]; // follow-up answers not sent yet
let defer: boolean;
let observer: MutationObserver | null = null;

beforeEach(() => {
  clearCaches();
  search = "status=follow_up";
  params = {};
  held = [];
  defer = false;
});
afterEach(() => {
  observer?.disconnect();
  observer = null;
  vi.restoreAllMocks();
});

// The fake server for ?follow_up=true. An answer is built when it is released, from `rows` at that time.
const install = (ids: number[]) => {
  rows = ids;
  fake = installFake({ apps: [...new Set([...ids, 4, 5, 9])].map((i) => makeApp(i, i === 9 ? { status: "offered" } : {})), interviews: [] });
  fake.on(
    "GET",
    /follow_up=true/,
    () => {
      const offset = Number(new URL(fake.calls.at(-1)!.path, "http://x").searchParams.get("offset"));
      const answer = (status = 200) =>
        status !== 200
          ? json(status, { detail: "Server error" })
          : json(200, {
              items: rows.slice(offset, offset + 50).map((id) => ({ ...makeApp(id), idle_days: 9, last_activity: "applied" })),
              total: rows.length,
              limit: 50,
              offset,
            });
      if (!defer) return answer();
      return new Promise<Response>((res) => held.push({ offset, release: (status) => res(answer(status)) }));
    },
    false,
  );
};
const many = (n: number) => Array.from({ length: n }, (_, i) => 100 - i);

const mount = () =>
  render(
    <ToastProvider>
      <ApplicationsScreen>{params.id ? <ApplicationDetailPage /> : null}</ApplicationsScreen>
    </ToastProvider>,
  );
const appList = () => document.querySelector<HTMLElement>('ul[aria-label="Applications"]');
const rowIds = () => [...(appList()?.querySelectorAll<HTMLAnchorElement>("a[href]") ?? [])].map((a) => Number(a.getAttribute("href")!.split("?")[0].split("/").pop()));
const listPane = () => document.querySelector<HTMLElement>('section[aria-label="Applications"]')!;
const detailPane = () => document.querySelector<HTMLElement>('section[aria-label="Application detail"]')!;
const followGets = () => fake.callsTo("GET", /follow_up=true/);
const release = async (i = 0, status?: number) => {
  const h = held[i];
  await act(async () => h.release(status));
};

function watchListSkeleton() {
  const seen = new Set<string>();
  const look = () => {
    for (const el of document.querySelectorAll(".animate-ledger-pulse")) if (el.closest('section[aria-label="Applications"]')) seen.add("list skeleton");
  };
  observer = new MutationObserver(look);
  observer.observe(document.body, { subtree: true, childList: true, attributes: true });
  return seen;
}

// Follow-up list [5, 4] with application 5 open (the two-pane layout), settled; later answers are held.
async function openFollowUp() {
  params = { id: "5" };
  install([5, 4]);
  mount();
  await waitFor(() => expect(rowIds()).toEqual([5, 4]));
  await within(detailPane()).findByText("No interviews yet.");
  defer = true;
}

it.each([
  ["clearDetail", () => clearDetail(5)],
  ["replaceDetail", () => replaceDetail(5, { application: makeApp(5), interviews: { items: [], total: 0 } })],
])("(a) %s: the follow-up rows stay (no skeleton) while page 1 is asked again, then the server's answer replaces them", async (_n, write) => {
  await openFollowUp();
  const before = followGets().length;
  const seen = watchListSkeleton();
  rows = [4]; // the interview put row 5 out of the follow-up view
  act(() => write());
  await act(async () => {});
  expect(rowIds()).toEqual([5, 4]);
  expect(followGets()).toHaveLength(before + 1);
  expect(seen.size).toBe(0);
  await release(0);
  await waitFor(() => expect(rowIds()).toEqual([4]));
  expect(seen.size).toBe(0);
  expect(listStale("follow_up")).toBe(false);
});

it("(b) a status change away from Applied: the follow-up rows stay (no skeleton), one refetch, then the server's answer", async () => {
  await openFollowUp();
  const before = followGets().length;
  const seen = watchListSkeleton();
  rows = [4];
  act(() => storeApplication(makeApp(5, { status: "offered" }), "applied"));
  await act(async () => {});
  expect(rowIds()).toEqual([5, 4]);
  expect(followGets()).toHaveLength(before + 1);
  await release(0);
  await waitFor(() => expect(rowIds()).toEqual([4]));
  expect(seen.size).toBe(0);
});

it("(c) an interview write does not restart another list's first load; the epoch re-asks once when the page lands", async () => {
  search = "status=offered";
  params = { id: "9" };
  install([]);
  let offered = 0;
  const pending: (() => void)[] = [];
  fake.on(
    "GET",
    /status=offered/,
    () => {
      const page = () => json(200, { items: [makeApp(9, { status: "offered" })], total: 1, limit: 50, offset: 0 });
      return ++offered === 1 ? new Promise<Response>((res) => pending.push(() => res(page()))) : page();
    },
    false,
  );
  mount();
  await waitFor(() => expect(offered).toBe(1));
  act(() => clearDetail(9));
  await act(async () => {});
  expect(fake.callsTo("GET", /status=offered/)).toHaveLength(1); // today's code restarts the load: 2
  await act(async () => pending[0]());
  await waitFor(() => expect(rowIds()).toEqual([9]));
  // Unchanged by design (the shared list epoch stays): the page requested before the write is refused and asked again once.
  expect(fake.callsTo("GET", /status=offered/)).toHaveLength(2);
});

it("(e) a Load more in flight when an interview is written: its rows are not appended, page 1 is asked, the rows stay", async () => {
  params = { id: "100" };
  install(many(60));
  mount();
  await waitFor(() => expect(rowIds()).toHaveLength(50));
  await within(detailPane()).findByText("No interviews yet.");
  defer = true;
  await userEvent.click(within(listPane()).getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(held).toHaveLength(1));
  expect(held[0].offset).toBe(50);
  const seen = watchListSkeleton();
  act(() => clearDetail(100));
  await act(async () => {});
  expect(rowIds()).toHaveLength(50);
  await waitFor(() => expect(held.some((h) => h.offset === 0)).toBe(true)); // page 1 asked again
  await release(0); // the page requested before the write lands
  await act(async () => {});
  expect(rowIds()).toHaveLength(50); // nothing appended
  expect(seen.size).toBe(0);
  const page1 = held.findIndex((h) => h.offset === 0);
  rows = many(55);
  await release(page1);
  await waitFor(() => expect(rowIds()).toHaveLength(50));
  expect(getList("follow_up")!.total).toBe(55);
  expect(listStale("follow_up")).toBe(false);
});

it("(f) written while no follow-up screen is mounted: the entry is kept stale; back on the screen it shows as refreshing and is replaced", async () => {
  install(many(60));
  const first = mount();
  await waitFor(() => expect(rowIds()).toHaveLength(50));
  first.unmount();
  act(() => clearDetail(100));
  expect(listStale("follow_up")).toBe(true);
  expect(getList("follow_up")?.items).toHaveLength(50);
  const before = followGets().length;
  defer = true;
  rows = many(70).slice(10); // ids 90..31: all new rows at the top of the page
  mount();
  expect(rowIds()).toHaveLength(50);
  expect(rowIds()[0]).toBe(100);
  expect((within(listPane()).getByRole("button", { name: "Load more" }) as HTMLButtonElement).disabled).toBe(true);
  await waitFor(() => expect(followGets()).toHaveLength(before + 1));
  expect(held[0].offset).toBe(0);
  await release(0);
  await waitFor(() => expect(rowIds()[0]).toBe(90));
  expect(rowIds()).toHaveLength(50);
  expect(listStale("follow_up")).toBe(false);
});

it("a failed refetch keeps the old rows and says so, never an empty list; Load more then asks page 1 again, not the next page", async () => {
  params = { id: "100" };
  install(many(60));
  mount();
  await waitFor(() => expect(rowIds()).toHaveLength(50));
  await within(detailPane()).findByText("No interviews yet.");
  defer = true;
  act(() => clearDetail(100));
  await waitFor(() => expect(held).toHaveLength(1));
  await release(0, 500);
  await screen.findByText("Couldn't refresh the list. Showing the last loaded rows.");
  expect(rowIds()).toHaveLength(50);
  expect(listStale("follow_up")).toBe(true); // only a stored answer clears it
  await userEvent.click(within(listPane()).getByRole("button", { name: "Load more" }));
  await waitFor(() => expect(held).toHaveLength(2));
  expect(held[1].offset).toBe(0); // page 1, never offset 50 appended onto stale rows
  expect(rowIds()).toHaveLength(50);
  await release(1);
  await waitFor(() => expect(listStale("follow_up")).toBe(false));
  expect(rowIds()).toHaveLength(50);
});

it("two quick interview writes: the last request's answer wins, an earlier answer landing later is ignored", async () => {
  await openFollowUp();
  act(() => clearDetail(5));
  await waitFor(() => expect(held).toHaveLength(1));
  act(() => clearDetail(5));
  await waitFor(() => expect(held).toHaveLength(2));
  rows = [4];
  await release(1);
  await waitFor(() => expect(rowIds()).toEqual([4]));
  rows = [5, 4];
  await release(0); // the earlier request, answered late
  await act(async () => {});
  expect(rowIds()).toEqual([4]);
});
