// In-memory caches for the applications screens (module state, so they survive client-side
// navigation but not a reload). Never touches web storage. Every write goes through
// clearCaches(): the api.ts mutations call it themselves, so no caller can forget, and auth calls
// it on login, logout and account deletion so one user's rows are never visible to the next.
import type { Application, Interview } from "./types";

export type ListEntry = { items: Application[]; total: number };
export type DetailEntry = { application: Application; interviews: { items: Interview[]; total: number } | null };

const lists = new Map<string, ListEntry>();
const details = new Map<number, DetailEntry>();
const listeners = new Set<() => void>();
let version = 0;

export const listKey = (status?: string) => status ?? "all";
export const getList = (status?: string) => lists.get(listKey(status));
export const setList = (status: string | undefined, entry: ListEntry) => void lists.set(listKey(status), entry);
export const getDetail = (id: number) => details.get(id);
export const setDetail = (id: number, entry: DetailEntry) => void details.set(id, entry);

export const cacheVersion = () => version;

/** Calls `fn` after every clearCaches(); returns the unsubscribe. */
export function onCachesCleared(fn: () => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export function clearCaches() {
  lists.clear();
  details.clear();
  version++;
  for (const fn of [...listeners]) fn();
}
