// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cacheVersion, clearCaches, clearDetail, detailStamp, getDetail, getList, onCachesCleared, setDetail, setList } from "../src/lib/cache";
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
