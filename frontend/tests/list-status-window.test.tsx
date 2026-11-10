// @vitest-environment jsdom
// A status change racing the list's own requests (PR #23 review round 2). A list response is stored
// only when it cannot straddle the PATCH: requested after the last status write ended, with no status
// write in flight when it lands. Anything else is re-issued, never dropped silently.
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { useApplicationList } from "../src/app/(app)/applications/(ledger)/use-list";
import { changeStatus, STATUS_TIMEOUT_MS } from "../src/lib/api";
import { login } from "../src/lib/auth";
import { clearCaches, getList, listsSettled, moveState, setList, storeApplication } from "../src/lib/cache";
import type { Application } from "../src/lib/types";
import { type Fake, installFake, json, makeApp } from "./helpers/fake-api";

let fake: Fake;
beforeEach(() => clearCaches());
afterEach(() => vi.restoreAllMocks());

const install = (apps: Application[]) => (fake = installFake({ apps, interviews: [] }));
const gate = () => {
  let release!: () => void;
  const p = new Promise<void>((r) => (release = r));
  return { p, release };
};
/** The server's page right now (newest first = id desc, as makeApp's created_at grows with id). */
const pageOf = (status: string | undefined, offset: number) => {
  const rows = fake.db.apps.filter((a) => !status || a.status === status).sort((a, b) => b.id - a.id);
  return { items: rows.slice(offset, offset + 50), total: rows.length, limit: 50, offset };
};
const ids = (rows?: Application[]) => (rows ?? []).map((a) => a.id);
const desc = (from: number, to: number) => Array.from({ length: from - to + 1 }, (_, i) => from - i);
/** The PATCH commits on the server at once, but its response waits for `g`. */
const slowPatch = (g: { p: Promise<void> }) =>
  fake.on("PATCH", /^\/applications\/\d+$/, async () => {
    const c = fake.calls.at(-1)!;
    const row = fake.db.apps.find((a) => a.id === Number(c.path.split("/").pop()))!;
    Object.assign(row, c.body);
    await g.p;
    return json(200, row);
  });
const flush = () => new Promise((r) => setTimeout(r, 0));

it("finding 1: a page 1 answered before a status change never lands on the patched cache", async () => {
  install(desc(3, 1).map((id) => makeApp(id)));
  setList("applied", { items: desc(3, 1).map((id) => makeApp(id)), total: 3, nextOffset: 3 }); // cached from earlier
  const g = gate();
  const before = pageOf("applied", 0); // the server's answer, taken before the change
  fake.on("GET", /status=applied/, async () => (await g.p, json(200, before)));
  fake.failNext("GET", /status=applied/); // the restarted page 1 fails, so the cache is what shows
  const { result } = renderHook(() => useApplicationList("applied"));
  fake.db.apps[1].status = "offered"; // id 2
  await act(async () => {
    storeApplication({ ...fake.db.apps[1] }, "applied");
    g.release();
    await g.p;
    await flush();
  });
  expect(ids(getList("applied")?.items)).toEqual([3, 1]);
  await waitFor(() => expect(result.current.view.kind === "ready" && result.current.view.refreshFailed).toBe(true));
  const v = result.current.view;
  expect(v.kind === "ready" && ids(v.items)).toEqual([3, 1]);
});

it("finding 2: a Load more answered after the commit but landing before the PATCH response is not patched twice", async () => {
  install(desc(52, 1).map((id) => makeApp(id)));
  const { result } = renderHook(() => useApplicationList("applied"));
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  const more = gate();
  fake.on("GET", /status=applied.*offset=50|offset=50.*status=applied/, async () => (await more.p, json(200, pageOf("applied", 50))));
  let loading!: Promise<void>;
  act(() => void (loading = result.current.loadMore()));
  const patch = gate();
  slowPatch(patch);
  const saving = changeStatus(52, "offered", "applied");
  await act(async () => {
    await flush(); // the PATCH has committed on the server
    more.release(); // Load more is answered from the committed data and lands first
    await more.p;
    await flush();
  });
  await act(async () => {
    patch.release();
    await saving;
    await loading;
    await flush();
  });
  // Every applied row is reachable: shown now, or behind a Load more that is still offered.
  await waitFor(() => {
    const v = result.current.view;
    expect(v.kind === "ready" && v.more).toBe("idle");
  });
  let v = result.current.view;
  if (v.kind === "ready" && v.nextOffset < v.total) {
    await act(() => result.current.loadMore());
    v = result.current.view;
  }
  expect(v.kind === "ready" && ids(v.items)).toEqual(desc(51, 1));
  expect(v.kind === "ready" && v.total).toBe(51);
});

it("finding 2: a page 1 answered after the commit but landing before the PATCH response counts the move once", async () => {
  install(desc(52, 1).map((id) => makeApp(id)));
  setList("applied", { items: desc(52, 3).map((id) => makeApp(id)), total: 52, nextOffset: 50 }); // cached, pre-change
  const one = gate();
  fake.on("GET", /status=applied/, async () => (await one.p, json(200, pageOf("applied", 0))));
  const { result } = renderHook(() => useApplicationList("applied"));
  const patch = gate();
  slowPatch(patch);
  const saving = changeStatus(52, "offered", "applied");
  await act(async () => {
    await flush();
    one.release(); // page 1 reflects the commit and lands before the PATCH response
    await one.p;
    await flush();
  });
  await act(async () => {
    patch.release();
    await saving;
    await flush();
  });
  await waitFor(() => expect(result.current.view.kind === "ready" && !result.current.view.refreshing).toBe(true));
  expect(getList("applied")?.total).toBe(51);
  expect(ids(getList("applied")?.items)).toEqual(desc(51, 2));
});

it("finding 3: when the list on screen is dropped by a status change it refetches, and Load more still works", async () => {
  install([...desc(60, 2).map((id) => makeApp(id, { status: "offered" })), makeApp(1, { status: "applied" })]);
  fake.db.apps[0].created_at = "not a date"; // id 60: the list's order around it cannot be computed
  const { result } = renderHook(() => useApplicationList("offered"));
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  const gets = fake.callsTo("GET", /status=offered/).length;
  await act(() => changeStatus(1, "offered", "applied"));
  await waitFor(() => expect(fake.callsTo("GET", /status=offered/).length).toBeGreaterThan(gets));
  await waitFor(() => {
    const v = result.current.view;
    expect(v.kind === "ready" && !v.refreshing && v.total).toBe(60);
  });
  await act(() => result.current.loadMore());
  const v = result.current.view;
  expect(v.kind === "ready" && v.items).toHaveLength(60);
  expect(v.kind === "ready" && ids(v.items)).toContain(1);
});

it("finding 6: a Load more in flight on All during a status change is re-issued, not dropped", async () => {
  install(desc(120, 1).map((id) => makeApp(id)));
  const { result } = renderHook(() => useApplicationList(undefined));
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  const more = gate();
  fake.on("GET", /offset=50/, async () => {
    const page = pageOf(undefined, 50); // answered before the change
    await more.p;
    return json(200, page);
  });
  let loading!: Promise<void>;
  act(() => void (loading = result.current.loadMore()));
  await act(() => changeStatus(100, "offered", "applied"));
  await act(async () => {
    more.release();
    await loading;
    await flush();
  });
  await waitFor(() => {
    const v = result.current.view;
    expect(v.kind === "ready" && v.items).toHaveLength(100);
  });
  const v = result.current.view;
  expect(v.kind === "ready" && v.items.find((a) => a.id === 100)?.status).toBe("offered");
  expect(v.kind === "ready" && v.more).toBe("idle");
});

// ---- the status-write window itself ----

it("a PATCH that fails (500) still ends the window: a stale Load more is re-issued and lands on unchanged data", async () => {
  install(desc(120, 1).map((id) => makeApp(id)));
  const { result } = renderHook(() => useApplicationList(undefined));
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  const more = gate();
  fake.on("GET", /offset=50/, async () => (await more.p, json(200, pageOf(undefined, 50))));
  let loading!: Promise<void>;
  act(() => void (loading = result.current.loadMore()));
  await waitFor(() => expect(fake.callsTo("GET", /offset=50/)).toHaveLength(1)); // sent before the PATCH
  fake.failNext("PATCH", /^\/applications\/\d+$/);
  await act(() => expect(changeStatus(100, "offered", "applied")).rejects.toMatchObject({ status: 500 }));
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
  await act(async () => {
    more.release();
    await loading;
  });
  expect(fake.callsTo("GET", /offset=50/)).toHaveLength(2); // the stale page, then the re-issue
  const v = result.current.view;
  expect(v.kind === "ready" && ids(v.items)).toEqual(desc(120, 21));
  expect(v.kind === "ready" && v.items.every((a) => a.status === "applied")).toBe(true);
});

it("a PATCH with no answer (network error) ends the window and clears the caches: the outcome is unknown", async () => {
  install(desc(3, 1).map((id) => makeApp(id)));
  const { result } = renderHook(() => useApplicationList("applied"));
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  fake.on("PATCH", /^\/applications\/\d+$/, () => Promise.reject(new TypeError("fetch failed")));
  const gets = fake.callsTo("GET", /status=applied/).length;
  await act(() => expect(changeStatus(2, "offered", "applied")).rejects.toMatchObject({ status: 0 }));
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
  await waitFor(() => expect(fake.callsTo("GET", /status=applied/).length).toBe(gets + 1));
  await waitFor(() => {
    const v = result.current.view;
    expect(v.kind === "ready" && ids(v.items)).toEqual([3, 2, 1]); // the server did not change it
  });
});

it("a status PATCH is abandoned after STATUS_TIMEOUT_MS: no answer, so the window ends and the caches clear", async () => {
  install(desc(3, 1).map((id) => makeApp(id)));
  setList("applied", { items: desc(3, 1).map((id) => makeApp(id)), total: 3, nextOffset: 3 });
  const ctl = new AbortController();
  const timeout = vi.spyOn(AbortSignal, "timeout").mockReturnValue(ctl.signal);
  fake.spy.mockImplementationOnce((_input, init) => new Promise((_r, reject) => init!.signal!.addEventListener("abort", () => reject(ctl.signal.reason))));
  const saving = changeStatus(2, "offered", "applied");
  expect(timeout).toHaveBeenCalledWith(STATUS_TIMEOUT_MS);
  expect(moveState().moving).toBe(1);
  ctl.abort(new DOMException("timed out", "TimeoutError"));
  await expect(saving).rejects.toMatchObject({ status: 0 });
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
  expect(getList("applied")).toBeUndefined();
});

it("two overlapping status changes: lists settle only after both end", async () => {
  install(desc(3, 1).map((id) => makeApp(id)));
  const a = gate();
  const b = gate();
  slowPatch(a);
  const first = changeStatus(1, "offered", "applied");
  slowPatch(b);
  const second = changeStatus(2, "offered", "applied");
  expect(moveState().moving).toBe(2);
  let settled = false;
  void listsSettled().then(() => (settled = true));
  a.release();
  await first;
  await flush();
  expect(moveState().moving).toBe(1);
  expect(settled).toBe(false);
  b.release();
  await second;
  await flush();
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
  expect(settled).toBe(true);
});

it("the list unmounting while a stale Load more waits for the window: no re-issue, no state update, waiter released", async () => {
  install(desc(120, 1).map((id) => makeApp(id)));
  const errors = vi.spyOn(console, "error");
  const { result, unmount } = renderHook(() => useApplicationList(undefined));
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  const more = gate();
  fake.on("GET", /offset=50/, async () => (await more.p, json(200, pageOf(undefined, 50))));
  let loading!: Promise<void>;
  act(() => void (loading = result.current.loadMore()));
  const patch = gate();
  slowPatch(patch);
  const saving = changeStatus(100, "offered", "applied");
  more.release();
  await more.p;
  await flush(); // the page landed during the write: stale, now waiting on listsSettled
  expect(moveState()).toEqual({ moving: 1, waiters: 1 });
  unmount();
  patch.release();
  await saving;
  await loading;
  await flush();
  expect(moveState()).toEqual({ moving: 0, waiters: 0 });
  expect(fake.callsTo("GET", /offset=50/)).toHaveLength(1); // never re-issued after unmount
  expect(errors).not.toHaveBeenCalled();
});

// ---- review round 3, finding 4: a status write that never ends ----

it("finding 4: a 401 on the status PATCH never settles; the auth reset (login) still ends the window and lists load", async () => {
  install(desc(3, 1).map((id) => makeApp(id)));
  vi.stubGlobal("location", { pathname: "/applications/2", search: "", replace: vi.fn() });
  try {
    fake.on("PATCH", /^\/applications\/\d+$/, () => json(401, { detail: "Not authenticated" }));
    void changeStatus(2, "offered", "applied"); // request() hands back a promise that never settles
    await flush();
    fake.on("POST", /^\/login$/, () => json(200, { detail: "Logged in" }));
    await login("a@example.com", "pw"); // the user signs in again in this tab
    const { result } = renderHook(() => useApplicationList("applied"));
    await waitFor(() => expect(result.current.view.kind).toBe("ready"));
    const v = result.current.view;
    expect(v.kind === "ready" && ids(v.items)).toEqual([3, 2, 1]);
  } finally {
    vi.unstubAllGlobals();
  }
});

it("finding 4: a no-answer clear from one status PATCH keeps the window of another still in flight", async () => {
  install(desc(3, 1).map((id) => makeApp(id)));
  const b = gate();
  fake.on("PATCH", /^\/applications\/\d+$/, () => Promise.reject(new TypeError("fetch failed")));
  const first = changeStatus(1, "offered", "applied");
  slowPatch(b);
  const second = changeStatus(2, "offered", "applied");
  await expect(first).rejects.toMatchObject({ status: 0 }); // clearCaches(), the second is still in flight
  const { result } = renderHook(() => useApplicationList("applied"));
  await waitFor(() => expect(fake.callsTo("GET", /status=applied/)).toHaveLength(1));
  await act(flush);
  expect(result.current.view.kind).toBe("loading"); // the page landed during the second write: refused
  expect(getList("applied")).toBeUndefined();
  await act(async () => {
    b.release();
    await second;
  });
  await waitFor(() => expect(result.current.view.kind).toBe("ready"));
  expect(fake.callsTo("GET", /status=applied/)).toHaveLength(2); // re-issued once after the window
  const v = result.current.view;
  expect(v.kind === "ready" && ids(v.items)).toEqual([3, 1]); // 2 moved to offered
});
