// @vitest-environment jsdom
// The follow-up list's data layer (F10 C3): the hook refetches when an interview write or a status
// change drops the list, pages with de-dup, and never stores a page requested before a drop.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApplicationList } from "../src/app/(app)/applications/(ledger)/use-list";
import { clearCaches, clearDetail, getList, replaceDetail, storeApplication } from "../src/lib/cache";
import type { ListRow } from "../src/lib/types";
import { type Fake, installFake, json, makeApp } from "./helpers/fake-api";

let fake: Fake;
let server: ListRow[]; // the follow-up rows the fake server holds, in list order
let hold: Promise<void> | null; // when set, the next answer waits for it (the body is read before)
beforeEach(() => {
  clearCaches();
  hold = null;
});
afterEach(() => vi.restoreAllMocks());

const row = (id: number, rest = {}): ListRow => ({ ...makeApp(id), follow_up: { idle_days: 30 - (id % 30), last_activity: "applied" }, ...rest });
const flat = (r: ListRow) => ({ ...r, ...r.follow_up });
const install = (rows: ListRow[]) => {
  server = rows;
  fake = installFake({ apps: [makeApp(1)], interviews: [] });
  fake.on(
    "GET",
    /follow_up=true/,
    async () => {
      const q = new URL(fake.calls.at(-1)!.path, "http://x").searchParams;
      const offset = Number(q.get("offset"));
      const body = { items: server.slice(offset, offset + 50).map(flat), total: server.length, limit: 50, offset };
      const wait = hold;
      hold = null;
      await wait;
      return json(200, body);
    },
    false,
  );
};
const gets = () => fake.callsTo("GET", /follow_up=true/);
const ids = (rows?: ListRow[]) => (rows ?? []).map((a) => a.id);
const mount = () => renderHook(() => useApplicationList("follow_up"));
const ready = async (r: ReturnType<typeof mount>) => waitFor(() => expect(r.result.current.view.kind).toBe("ready"));

it("loads page 1 with follow_up=true, no status, and keeps the follow-up part on each row", async () => {
  install([row(3), row(2)]);
  const r = mount();
  await ready(r);
  expect(gets()[0].path).toBe("/applications?limit=50&offset=0&follow_up=true");
  const v = r.result.current.view;
  if (v.kind !== "ready") throw new Error("not ready");
  expect(v.items.map((a) => a.follow_up?.idle_days)).toEqual([27, 28]);
  expect(getList("follow_up")?.total).toBe(2);
  expect(getList("applied")).toBeUndefined(); // its own key, no other list is filled
});

it("an interview write (clearDetail) drops the follow-up list and refetches page 1", async () => {
  install([row(3), row(2)]);
  const r = mount();
  await ready(r);
  server = [row(3)]; // the interview made row 2 ineligible
  act(() => clearDetail(2));
  await waitFor(() => expect(gets()).toHaveLength(2));
  await waitFor(() => expect(ids(getList("follow_up")?.items)).toEqual([3]));
});

it("an interview delete (replaceDetail) refetches the follow-up list too", async () => {
  install([row(3), row(2)]);
  const r = mount();
  await ready(r);
  act(() => replaceDetail(2, { application: makeApp(2), interviews: { items: [], total: 0 } }));
  await waitFor(() => expect(gets()).toHaveLength(2));
});

it("a status change refetches the follow-up list (it is dropped, never patched)", async () => {
  install([row(3), row(2)]);
  const r = mount();
  await ready(r);
  server = [row(3)];
  act(() => storeApplication(makeApp(2, { status: "screening" }), "applied"));
  await waitFor(() => expect(gets()).toHaveLength(2));
  await waitFor(() => expect(ids(getList("follow_up")?.items)).toEqual([3]));
});

it("Load more asks for nextOffset with follow_up=true and de-duplicates", async () => {
  const all = Array.from({ length: 60 }, (_, i) => row(100 - i));
  install(all);
  const r = mount();
  await ready(r);
  expect(getList("follow_up")?.nextOffset).toBe(50);
  // One row of page 1 shifted onto page 2 (the server's list moved by one).
  server = [row(200), ...all.slice(0, 59)];
  await act(() => r.result.current.loadMore());
  expect(gets().at(-1)!.path).toBe("/applications?limit=50&offset=50&follow_up=true");
  const entry = getList("follow_up")!;
  expect(new Set(ids(entry.items)).size).toBe(entry.items.length);
  expect(entry.items.length).toBe(59); // 50 + 10 server rows - 1 duplicate
  expect(entry.nextOffset).toBe(60);
  expect(entry.total).toBe(60);
  expect(r.result.current.announcement).toBe("9 more applications loaded");
});

it("a page requested before an interview write is not stored; the list is fetched again", async () => {
  install([row(9, { company: "Stale Co" })]);
  let release!: () => void;
  hold = new Promise<void>((res) => (release = res));
  const r = mount();
  await waitFor(() => expect(gets()).toHaveLength(1));
  server = [row(3)];
  act(() => clearDetail(9)); // an interview write while page 1 is in flight
  release();
  await ready(r);
  await waitFor(() => expect(ids(getList("follow_up")?.items)).toEqual([3]));
  expect(gets()).toHaveLength(2);
  expect(JSON.stringify(getList("follow_up"))).not.toContain("Stale Co");
});
