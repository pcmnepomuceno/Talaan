// In-memory caches for the applications screens (module state, so they survive client-side
// navigation but not a reload). Never touches web storage. Every write goes through
// clearCaches(): the api.ts mutations call it themselves, so no caller can forget, and auth calls
// it on login, logout and account deletion so one user's rows are never visible to the next.
// The one narrower clear is clearDetail(id), for interview writes: an interview changes nothing a
// list row shows (list fields come from the application, and the order is created_at), so the lists
// and every other detail stay valid.
import type { Application, Interview } from "./types";

// nextOffset = the server offset of the next page: offset + rows the server sent, which can be more
// than items.length when de-duplication dropped rows. Load more is offered while it is below total.
export type ListEntry = { items: Application[]; total: number; nextOffset: number };
export type DetailEntry = { application: Application; interviews: { items: Interview[]; total: number } | null };

const lists = new Map<string, ListEntry>();
const details = new Map<number, DetailEntry>();
// An id is passed when only that application's detail was cleared; undefined means everything was.
const listeners = new Set<(id?: number) => void>();
let version = 0; // bumped by clearCaches() only: guards in-flight list responses
const detailBumps = new Map<number, number>(); // per id, bumped by clearDetail(): guards in-flight detail responses

export const listKey = (status?: string) => status ?? "all";
export const getList = (status?: string) => lists.get(listKey(status));
export const setList = (status: string | undefined, entry: ListEntry) => void lists.set(listKey(status), entry);
export const getDetail = (id: number) => details.get(id);
export const setDetail = (id: number, entry: DetailEntry) => void details.set(id, entry);
export const dropDetail = (id: number) => void details.delete(id);

export const cacheVersion = () => version;
/** Changes whenever this id's detail is cleared by clearDetail(). Pair it with cacheVersion(). */
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
  for (const fn of [...listeners]) fn();
}

// ---- status change: exact patch from the server's row (no clear, no refetch) ----
// The list order is created_at desc, id desc (the API's ORDER BY), which a status never changes, so a
// status change only moves the row in or out of the filtered lists. Every list is patched exactly.

/** a sorts before b in the list order; null when created_at cannot be compared exactly. */
function sortsBefore(a: Application, b: Application): boolean | null {
  const ta = Date.parse(a.created_at);
  const tb = Date.parse(b.created_at);
  if (Number.isNaN(ta) || Number.isNaN(tb)) return null;
  return ta !== tb ? ta > tb : a.id > b.id;
}

/**
 * One list after `row` changed from `oldStatus` to `row.status`. Returns `entry` itself when nothing
 * changes, and undefined when the row's place cannot be found exactly (drop that list; it refetches
 * when viewed). `nextOffset` is the server offset of the next unsent row, so it moves with every row
 * removed or inserted before it.
 */
export function patchList(key: string, entry: ListEntry, row: Application, oldStatus: string): ListEntry | undefined {
  const i = entry.items.findIndex((a) => a.id === row.id);
  if (key === listKey()) {
    if (i === -1) return entry;
    return { ...entry, items: entry.items.map((a) => (a.id === row.id ? row : a)) };
  }
  if (key === row.status && i !== -1) return { ...entry, items: entry.items.map((a) => (a.id === row.id ? row : a)) };
  if (key === oldStatus) {
    // Held: it was among the rows sent, so the cursor moves back one. Not held: it was beyond the cursor.
    if (i === -1) return { ...entry, total: Math.max(0, entry.total - 1) };
    return { items: entry.items.filter((a) => a.id !== row.id), total: Math.max(0, entry.total - 1), nextOffset: Math.max(0, entry.nextOffset - 1) };
  }
  if (key !== row.status) return entry;
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
  // After every held row: shown now only when the list is complete; otherwise a later page sends it.
  if (at === entry.items.length && entry.nextOffset < entry.total) return { ...entry, total: entry.total + 1 };
  return { items: [...entry.items.slice(0, at), row, ...entry.items.slice(at)], total: entry.total + 1, nextOffset: entry.nextOffset + 1 };
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
 * still valid) and the screens take the row from the cache, not from a refetch.
 */
export function storeApplication(row: Application, oldStatus: string) {
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
