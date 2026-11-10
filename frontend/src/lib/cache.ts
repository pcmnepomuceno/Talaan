// In-memory caches for the applications screens (module state, so they survive client-side
// navigation but not a reload). Never touches web storage. Only the api.ts writes and auth change
// them, so no screen can forget to (the per-write rules are listed at the top of api.ts):
//   - clearCaches(): everything is dropped and refetched. Application create, edit and delete, any
//     404 on a write, and a status PATCH with no answer.
//   - resetCaches(): clearCaches() and every status window ends (login, logout and account deletion:
//     one user's rows never reach the next, and a write cut off by a 401 never blocks the lists).
//   - clearDetail(id): one detail is dropped and refetched (interview create and edit). An interview
//     changes nothing a list row shows, so the lists and every other detail stay valid.
//   - replaceDetail(id, entry): like clearDetail, but the entry is replaced in the same step, so the
//     detail never shows a skeleton while it refetches (interview delete).
//   - storeApplication(row, from): a status change. Every list and the detail are patched from the
//     server's row; only a list whose result cannot be known is dropped (patchList). The list stamp
//     moves, and changeStatus brackets the PATCH with beginMove()/endMove() (see listFresh).
// Each of these sets the new state before notifying listeners, in one synchronous call, so no
// caller has to win a race against React's next render.
import type { Application, Interview } from "./types";

// nextOffset = the server offset of the next page: offset + rows the server sent, which can be more
// than items.length when de-duplication dropped rows. Load more is offered while it is below total.
export type ListEntry = { items: Application[]; total: number; nextOffset: number };
export type DetailEntry = { application: Application; interviews: { items: Interview[]; total: number } | null };

const lists = new Map<string, ListEntry>();
const details = new Map<number, DetailEntry>();
// An id is passed when only that application's detail was cleared; undefined means everything was.
const listeners = new Set<(id?: number) => void>();
let version = 0; // bumped by clearCaches() only: guards in-flight detail responses (lists: listStamp)
const detailBumps = new Map<number, number>(); // per id, bumped by clearDetail() and replaceDetail(): guards in-flight detail responses

export const listKey = (status?: string) => status ?? "all";
// Set by the first list or detail the server sent in this tab and never reset (a clear included):
// once anything has loaded the API is awake, so the slow-start line (DESIGN.md 6.12) is not shown again.
let loaded = false;
export const loadedOnce = () => loaded;
/** Tests only: start again as a fresh tab. */
export const forgetLoaded = () => void (loaded = false);

export const getList = (status?: string) => lists.get(listKey(status));
export const setList = (status: string | undefined, entry: ListEntry) => {
  loaded = true;
  lists.set(listKey(status), entry);
};
export const getDetail = (id: number) => details.get(id);
export const setDetail = (id: number, entry: DetailEntry) => {
  loaded = true;
  details.set(id, entry);
};
export const dropDetail = (id: number) => void details.delete(id);

export const cacheVersion = () => version;
/** Changes whenever this id's detail is cleared or replaced (clearDetail, replaceDetail). Pair it with cacheVersion(). */
export const detailStamp = (id: number) => detailBumps.get(id) ?? 0;

/** Calls `fn` after every clear: with the id after clearDetail(id), with nothing after clearCaches(). */
export function onCachesCleared(fn: (id?: number) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function clearCaches() {
  lists.clear();
  details.clear();
  version++;
  listEpoch++;
  for (const fn of [...listeners]) fn();
}

// ---- list responses and status writes ----
// A list page may be stored only when it cannot straddle a status PATCH: it was requested after the
// last change to the lists (listStamp unchanged) and no status write is in flight when it lands. A
// page the server answered after the commit but that lands before the PATCH response would otherwise
// get the change applied twice by patchList. A refused page is re-issued once the writes end.
let listEpoch = 0; // bumped by clearCaches(), storeApplication() and beginMove()
let moving = 0; // status writes in flight
const settled = new Set<() => void>();

export const listStamp = () => listEpoch;
/** A list response requested at `stamp` may be stored now. */
export const listFresh = (stamp: number) => stamp === listEpoch && moving === 0;
/** Resolves once no status write is in flight (at once when none is). */
export const listsSettled = () => (moving === 0 ? Promise.resolve() : new Promise<void>((r) => settled.add(r)));
/** Tests only. */
export const moveState = () => ({ moving, waiters: settled.size });

/**
 * clearCaches() plus the end of every status window, for login, logout and account deletion only.
 * A status PATCH answered 401 never settles (request() leaves the page for /login), so its endMove()
 * never runs; this is what ends it. Plain clearCaches() leaves the window alone: another status
 * PATCH may still be in flight, and its list pages must still be refused.
 */
export function resetCaches() {
  moving = 0;
  releaseWaiters();
  clearCaches();
}

/** Call before a status PATCH is sent; endMove() in its `finally`. */
export function beginMove() {
  moving++;
  listEpoch++;
}
export function endMove() {
  moving = Math.max(0, moving - 1);
  if (moving === 0) releaseWaiters();
}
function releaseWaiters() {
  const waiters = [...settled];
  settled.clear();
  for (const r of waiters) r();
}

// ---- status change: exact patch from the server's row (no clear, no refetch) ----
// The list order is created_at desc, id desc (the API's ORDER BY), which a status never changes, so a
// status change only moves the row in or out of the filtered lists. Each list is patched from its own
// rows, or dropped when its result cannot be known.

/** a sorts before b in the list order; null when created_at cannot be compared exactly. */
function sortsBefore(a: Application, b: Application): boolean | null {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return ta !== tb ? ta > tb : a.id > b.id;
}

/**
 * One list after the server returned `row` for a status change from `oldStatus`. Derived from the
 * list's own rows. Not idempotent: a second application drops an incomplete list of `oldStatus`
 * (the row is no longer held, so it may sit beyond the cursor). The list epoch (listFresh,
 * listStamp) is what makes sure no list is patched twice. Returns `entry` itself when nothing
 * changes, and undefined when the result cannot be known exactly (drop that list; it refetches).
 * `nextOffset` is the server offset of the next unsent row, so it moves with every row removed or
 * inserted before it.
 *   - all: a held row is replaced in place (order, total and cursor never depend on status).
 *   - a status list holding the row under another status: removed, total - 1, nextOffset - 1,
 *     whatever `oldStatus` says (another tab may have moved it already).
 *   - the row's new status: replaced if held; inserted at its sorted place inside the held rows or
 *     into a complete list (+1/+1); beyond the cursor of an incomplete list, dropped.
 *   - `oldStatus` not holding the row: unchanged when complete; dropped when incomplete (the row
 *     may sit beyond the cursor, and whether `total` still counts it cannot be known).
 */
export function patchList(key: string, entry: ListEntry, row: Application, oldStatus: string): ListEntry | undefined {
  const i = entry.items.findIndex((a) => a.id === row.id);
  const replaced = () => ({ ...entry, items: entry.items.map((a) => (a.id === row.id ? row : a)) });
  const complete = entry.nextOffset >= entry.total;
  if (key === listKey()) return i === -1 ? entry : replaced();
  if (i !== -1) {
    if (key === row.status) return replaced();
    return { items: entry.items.filter((a) => a.id !== row.id), total: Math.max(0, entry.total - 1), nextOffset: Math.max(0, entry.nextOffset - 1) };
  }
  if (key === row.status) {
    // The row joins this list. Its place among the held rows (or after all of them):
    let at = entry.items.length;
    for (let j = 0; j < entry.items.length; j++) {
      const before = sortsBefore(row, entry.items[j]);
      if (before === null) return undefined;
      if (before) {
        at = j;
        break;
      }
    }
    if (at === entry.items.length && !complete) return undefined;
    return { items: [...entry.items.slice(0, at), row, ...entry.items.slice(at)], total: entry.total + 1, nextOffset: entry.nextOffset + 1 };
  }
  if (key === oldStatus && !complete) return undefined;
  return entry;
}

const stored = new Set<(row: Application) => void>();
/** Calls `fn` after storeApplication(), once every cache already holds the new row. */
export function onApplicationStored(fn: (row: Application) => void) {
  stored.add(fn);
  return () => void stored.delete(fn);
}

/**
 * A status change the server confirmed: patch every cached list and the cached detail with the
 * server's row, then notify, in one synchronous step. Nothing is cleared: the version and the detail
 * stamps stay, because a status change cannot alter interviews (an in-flight interviews request is
 * still valid) and the screens take the row from the cache, not from a refetch. The list stamp moves,
 * so a list page requested before this point is re-issued instead of stored over the patch.
 */
export function storeApplication(row: Application, oldStatus: string) {
  listEpoch++;
  for (const [key, entry] of [...lists]) {
    const next = patchList(key, entry, row, oldStatus);
    if (next === undefined) lists.delete(key);
    else if (next !== entry) lists.set(key, next);
  }
  const d = details.get(row.id);
  if (d) details.set(row.id, { ...d, application: row });
  for (const fn of [...stored]) fn(row);
}

function bumpDetail(id: number) {
  detailBumps.set(id, detailStamp(id) + 1);
  for (const fn of [...listeners]) fn(id);
}

/** Drops one application's detail only (an interview write). Lists and other details stay. */
export function clearDetail(id: number) {
  details.delete(id);
  bumpDetail(id);
}

/**
 * Like clearDetail(id) (in-flight detail responses are dropped, listeners refetch), but the entry is
 * replaced instead of dropped, in the same synchronous step, so the first render after the
 * notification already finds `entry`: no caller has to win a race against React's render.
 */
export function replaceDetail(id: number, entry: DetailEntry) {
  details.set(id, entry);
  bumpDetail(id);
}
