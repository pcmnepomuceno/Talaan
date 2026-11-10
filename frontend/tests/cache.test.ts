// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cacheVersion, clearCaches, clearDetail, detailStamp, getDetail, getList, onApplicationStored, onCachesCleared, patchList, replaceDetail, setDetail, setList, storeApplication } from "../src/lib/cache";
import { makeApp } from "./helpers/fake-api";
import { deleteAccount, login, logout } from "../src/lib/auth";

const entry = { items: [], total: 0, nextOffset: 0 };
beforeEach(() => {
  clearCaches();
  vi.stubGlobal("location", { pathname: "/account", search: "", replace: vi.fn() });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("clearCaches empties lists and details, bumps the version and tells listeners", () => {
  setList(undefined, entry);
  setList("applied", entry);
  setDetail(1, { application: {} as never, interviews: null });
  const fn = vi.fn();
  const off = onCachesCleared(fn);
  const v = cacheVersion();
  clearCaches();
  expect([getList(), getList("applied"), getDetail(1)]).toEqual([undefined, undefined, undefined]);
  expect(cacheVersion()).toBe(v + 1);
  expect(fn).toHaveBeenCalledTimes(1);
  off();
  clearCaches();
  expect(fn).toHaveBeenCalledTimes(1);
});

it("clearDetail drops one detail, keeps the lists and other details, and tells listeners which id", () => {
  setList(undefined, entry);
  setDetail(1, { application: {} as never, interviews: null });
  setDetail(2, { application: {} as never, interviews: null });
  const fn = vi.fn();
  const off = onCachesCleared(fn);
  const v = cacheVersion();
  const stamp1 = detailStamp(1);
  clearDetail(1);
  expect(getDetail(1)).toBeUndefined();
  expect(getDetail(2)).toBeDefined();
  expect(getList()).toBe(entry);
  expect(cacheVersion()).toBe(v); // the lists' version is untouched: in-flight list responses stay valid
  expect(detailStamp(1)).toBe(stamp1 + 1);
  expect(detailStamp(2)).toBe(0);
  expect(fn).toHaveBeenCalledWith(1);
  clearCaches();
  expect(fn.mock.lastCall).toEqual([]); // a full clear names no id
  off();
});

it.each([
  ["login", () => login("a@b.ph", "x")],
  ["logout", () => logout()],
  ["deleteAccount", () => deleteAccount("x")],
])("%s clears the caches", async (_n, run) => {
  vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(JSON.stringify({ detail: "ok" }), { status: 200 }));
  setList(undefined, entry);
  await run();
  expect(getList()).toBeUndefined();
});

it("replaceDetail swaps the entry before listeners run, bumps only that id's stamp, and keeps the lists", () => {
  setList(undefined, entry);
  const before = { application: { id: 1 } as never, interviews: null };
  const after = { application: { id: 1 } as never, interviews: { items: [], total: 0 } };
  setDetail(1, before);
  const v = cacheVersion();
  const stamp = detailStamp(1);
  const seen: unknown[] = [];
  const off = onCachesCleared((id) => seen.push([id, getDetail(1)]));
  replaceDetail(1, after);
  expect(seen).toEqual([[1, after]]); // atomic: the listener already finds the replacement
  expect(detailStamp(1)).toBe(stamp + 1);
  expect(cacheVersion()).toBe(v);
  expect(getList()).toBe(entry);
  off();
});

// ---- status change: patchList (PR #23 review item 1) ----
// makeApp(n) is created n minutes after a fixed time, so a higher id is newer (listed first).
const app = (id: number, status: "applied" | "offered" | "saved" | "screening" | "interviewing", rest = {}) => makeApp(id, { status, ...rest });
const ids = (e: { items: { id: number }[] } | undefined) => e?.items.map((a) => a.id);

it("patchList, all: replaces a held row in place (order, total and cursor unchanged); a row it does not hold changes nothing", () => {
  const e = { items: [app(3, "applied"), app(2, "applied"), app(1, "applied")], total: 10, nextOffset: 3 };
  const out = patchList("all", e, app(2, "offered"), "applied")!;
  expect(ids(out)).toEqual([3, 2, 1]);
  expect(out.items[1].status).toBe("offered");
  expect([out.total, out.nextOffset]).toEqual([10, 3]);
  expect(patchList("all", e, app(9, "offered"), "applied")).toBe(e);
});

it("patchList, old status holding the row: removed, total - 1, nextOffset - 1", () => {
  const e = { items: [app(3, "applied"), app(2, "applied"), app(1, "applied")], total: 10, nextOffset: 3 };
  const out = patchList("applied", e, app(2, "offered"), "applied")!;
  expect(ids(out)).toEqual([3, 1]);
  expect([out.total, out.nextOffset]).toEqual([9, 2]);
});

it("patchList, old status not holding the row: an incomplete list is dropped (the server count may already exclude it); a complete one is unchanged", () => {
  const e = { items: [app(30, "applied"), app(29, "applied")], total: 10, nextOffset: 2 };
  expect(patchList("applied", e, app(5, "offered"), "applied")).toBeUndefined();
  const complete = { items: [app(30, "applied"), app(29, "applied")], total: 2, nextOffset: 2 };
  expect(patchList("applied", complete, app(5, "offered"), "applied")).toBe(complete);
});

it("patchList, new status, complete list: inserted at its sorted place, ties on created_at ordered by id desc", () => {
  const t = "2026-10-01T09:00:00+08:00";
  const e = { items: [app(9, "offered", { created_at: "2026-10-02T00:00:00Z" }), app(6, "offered", { created_at: t }), app(4, "offered", { created_at: t }), app(2, "offered")], total: 4, nextOffset: 4 };
  const out = patchList("offered", e, app(5, "offered", { created_at: "2026-10-01T01:00:00Z" }), "applied")!; // the same instant as t
  expect(ids(out)).toEqual([9, 6, 5, 4, 2]);
  expect([out.total, out.nextOffset]).toEqual([5, 5]);
  // complete list, the row is the oldest: appended at the end (no "range" rule for a complete list)
  const last = patchList("offered", e, app(1, "offered"), "applied")!;
  expect(ids(last)).toEqual([9, 6, 4, 2, 1]);
  expect([last.total, last.nextOffset]).toEqual([5, 5]);
});

it("patchList, new status, more pages: inside the held range inserted (+1/+1); after the last held row the list is dropped", () => {
  const e = { items: [app(9, "offered"), app(7, "offered")], total: 6, nextOffset: 2 };
  const inside = patchList("offered", e, app(8, "offered"), "applied")!;
  expect(ids(inside)).toEqual([9, 8, 7]);
  expect([inside.total, inside.nextOffset]).toEqual([7, 3]);
  // Beyond the cursor: whether `total` already counts it cannot be known, so nothing is guessed.
  expect(patchList("offered", e, app(3, "offered"), "applied")).toBeUndefined();
});

it("patchList, new status already holding the row: replaced in place, no count change (never inserted twice)", () => {
  const e = { items: [app(9, "offered"), app(8, "offered", { company: "Old" }), app(7, "offered")], total: 6, nextOffset: 3 };
  const out = patchList("offered", e, app(8, "offered"), "applied")!;
  expect(ids(out)).toEqual([9, 8, 7]);
  expect(out.items[1].company).toBe("Company 8");
  expect([out.total, out.nextOffset]).toEqual([6, 3]);
});

it("finding 4: a status list holding the row under another status loses it, whatever `from` says", () => {
  setList("applied", { items: [app(8, "applied"), app(7, "applied"), app(6, "applied")], total: 3, nextOffset: 3 });
  // Another tab moved 7 to screening; this tab's detail says screening and changes it to interviewing.
  storeApplication(app(7, "interviewing"), "screening");
  expect(ids(getList("applied"))).toEqual([8, 6]);
  expect([getList("applied")!.total, getList("applied")!.nextOffset]).toEqual([2, 2]);
});

it("patchList applied twice changes no count twice", () => {
  const lists = {
    all: { items: [app(9, "applied"), app(8, "applied")], total: 2, nextOffset: 2 },
    applied: { items: [app(9, "applied"), app(8, "applied")], total: 2, nextOffset: 2 },
    offered: { items: [app(10, "offered")], total: 1, nextOffset: 1 },
  };
  const row = app(8, "offered");
  for (const [key, e] of Object.entries(lists)) {
    const once = patchList(key, e, row, "applied")!;
    expect(patchList(key, once, row, "applied")).toEqual(once);
  }
});

it("patchList, new status: a created_at that cannot be ordered exactly drops that list instead of guessing", () => {
  const e = { items: [app(9, "offered"), app(7, "offered")], total: 2, nextOffset: 2 };
  expect(patchList("offered", e, app(8, "offered", { created_at: "not a date" }), "applied")).toBeUndefined();
  const badHeld = { items: [app(9, "offered", { created_at: "??" })], total: 1, nextOffset: 1 };
  expect(patchList("offered", badHeld, app(8, "offered"), "applied")).toBeUndefined();
});

it("patchList, a list for another status is unchanged", () => {
  const e = { items: [app(4, "saved")], total: 1, nextOffset: 1 };
  expect(patchList("saved", e, app(2, "offered"), "applied")).toBe(e);
});

it("storeApplication patches every list and the detail before its listeners run, and clears nothing", () => {
  setList(undefined, { items: [app(2, "applied"), app(1, "applied")], total: 2, nextOffset: 2 });
  setList("applied", { items: [app(2, "applied"), app(1, "applied")], total: 2, nextOffset: 2 });
  setList("offered", { items: [], total: 0, nextOffset: 0 });
  setList("saved", entry);
  setDetail(2, { application: app(2, "applied"), interviews: { items: [], total: 0 } });
  const v = cacheVersion();
  const stamp = detailStamp(2);
  const cleared = vi.fn();
  const offC = onCachesCleared(cleared);
  const seen: unknown[] = [];
  const off = onApplicationStored((a) => seen.push([a.id, ids(getList()), ids(getList("applied")), ids(getList("offered")), getDetail(2)?.application.status]));
  storeApplication(app(2, "offered"), "applied");
  expect(seen).toEqual([[2, [2, 1], [1], [2], "offered"]]);
  expect(getList("saved")).toBe(entry);
  expect(getDetail(2)?.interviews).toEqual({ items: [], total: 0 });
  expect(cacheVersion()).toBe(v);
  expect(detailStamp(2)).toBe(stamp);
  expect(cleared).not.toHaveBeenCalled();
  off();
  offC();
});
