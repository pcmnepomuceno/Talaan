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

/** Drops one application's detail only (an interview write). Lists and other details stay. */
export function clearDetail(id: number) {
  details.delete(id);
  detailBumps.set(id, detailStamp(id) + 1);
  for (const fn of [...listeners]) fn(id);
}
