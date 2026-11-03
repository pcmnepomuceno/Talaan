// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cacheVersion, clearCaches, getDetail, getList, onCachesCleared, setDetail, setList } from "../src/lib/cache";
import { deleteAccount, login, logout } from "../src/lib/auth";

const entry = { items: [], total: 0 };
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
