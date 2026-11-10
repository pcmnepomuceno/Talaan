"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApplications } from "@/lib/api";
import { getList, listFresh, listsSettled, listStamp, onApplicationStored, onCachesCleared, setList } from "@/lib/cache";
import type { Application, Status } from "@/lib/types";

// One status tab = one cached list, fetched 50 at a time from the server (the API pages and
// filters). Cached rows show at once while page 1 is refetched; the fresh page 1 then REPLACES the
// entry, dropping any extra pages the user had loaded, because their offsets may have shifted.
// A full clear (clearCaches) empties the cache and refetches the current tab; a status change
// (storeApplication) patches the cached rows, which the view reads directly. A page that may straddle
// a status write (listFresh false) is never stored: it is re-issued once the write ends. Load more asks for
// nextOffset (rows the server has sent), not items.length (rows left after de-duplication); a
// page that adds no new row means the offsets shifted, so Load more is withdrawn and page 1 refetched.
export type ListView =
  | { kind: "loading" }
  | { kind: "failed" }
  | {
      kind: "ready";
      items: Application[];
      total: number;
      nextOffset: number;
      refreshing: boolean; // showing cached rows while page 1 is refetched
      refreshFailed: boolean; // showing cached rows, the background refetch failed
      more: "idle" | "loading" | "failed";
    };

// The rows live in the cache only (getList); this is the outcome of the current key's page 1 and Load more.
type Fetched = { key: string; failed: boolean; refreshFailed: boolean; more: "idle" | "loading" | "failed" };

/** Adds `incoming` rows whose id is not already present, in order. */
export function appendUnique(existing: Application[], incoming: Application[]): Application[] {
  const seen = new Set(existing.map((a) => a.id));
  return [...existing, ...incoming.filter((a) => !seen.has(a.id))];
}

/** How long "N more applications loaded" stays in the live region before it is cleared. */
export const ANNOUNCE_MS = 5000;

export function useApplicationList(status: Status | undefined) {
  const [tick, setTick] = useState(0);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const key = `${status ?? "all"}:${tick}`;

  // The screen's live region falls back to this text after every loading message, so it must not
  // outlive the moment it describes: cleared on a tab switch or refetch (new key), after
  // ANNOUNCE_MS, and by the screen when a detail loads (clearAnnouncement). The timer dies on unmount.
  const [announcedKey, setAnnouncedKey] = useState(key);
  if (announcedKey !== key) {
    setAnnouncedKey(key);
    setAnnouncement("");
  }
  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(""), ANNOUNCE_MS);
    return () => clearTimeout(t);
  }, [announcement]);
  const clearAnnouncement = useCallback(() => setAnnouncement(""), []);
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  const moreBusy = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Only a full clear refetches: an interview write clears one detail (an id is passed) and no list row changes.
  useEffect(() => onCachesCleared((id) => id === undefined && setTick((n) => n + 1)), []);

  // A status change patched the cached lists in place (storeApplication): re-render from the cache,
  // or refetch when the list on screen was dropped (its order around the row was unknown).
  const [, setPatched] = useState(0);
  useEffect(() => onApplicationStored(() => (getList(status) ? setPatched((n) => n + 1) : setTick((n) => n + 1))), [status]);

  useEffect(() => {
    let live = true;
    const s = listStamp();
    // Requested before a write, or landing during a status write: ask again once the writes end.
    const again = () => void listsSettled().then(() => live && setTick((n) => n + 1));
    getApplications(status).then(
      (page) => {
        if (!live) return;
        if (!listFresh(s)) return again();
        setList(status, { ...page, nextOffset: page.items.length });
        setFetched({ key, failed: false, refreshFailed: false, more: "idle" });
      },
      () => {
        if (!live) return;
        if (!listFresh(s)) return again();
        const cached = !!getList(status);
        setFetched({ key, failed: !cached, refreshFailed: cached, more: "idle" });
      },
    );
    return () => {
      live = false;
    };
  }, [status, key]);

  // Stable: the screen's focus effect lists it as a dependency and must run once per focus request.
  const clearFocus = useCallback(() => setFocusId(null), []);

  const retry = useCallback(() => {
    setFetched(null);
    setTick((n) => n + 1);
  }, []);

  const loadMore = useCallback(async () => {
    const at = keyRef.current;
    if (!getList(status) || moreBusy.current) return;
    moreBusy.current = true;
    setAnnouncement("");
    const mark = (more: Fetched["more"]) => setFetched((f) => (f && f.key === at ? { ...f, more } : f));
    const here = () => mounted.current && keyRef.current === at;
    mark("loading");
    try {
      // A page that may straddle a status write is asked again once, from the patched cursor.
      for (let attempt = 0; ; attempt++) {
        await listsSettled();
        const cur = getList(status);
        if (!here() || !cur) return;
        const s = listStamp();
        const page = await getApplications(status, cur.nextOffset);
        if (!here()) return;
        if (!listFresh(s)) {
          if (attempt === 0) continue;
          mark("idle"); // still moving: offer Load more again
          return;
        }
        const items = appendUnique(cur.items, page.items);
        const added = items.length - cur.items.length;
        if (added === 0) {
          // Nothing new: the offsets shifted under us. Stop offering Load more (nextOffset = total)
          // and refetch page 1, which replaces this entry with a fresh start.
          setList(status, { items, total: page.total, nextOffset: page.total });
          setTick((n) => n + 1);
          return;
        }
        setList(status, { items, total: page.total, nextOffset: cur.nextOffset + page.items.length });
        mark("idle");
        setAnnouncement(`${added} more ${added === 1 ? "application" : "applications"} loaded`);
        setFocusId(items[cur.items.length].id);
        return;
      }
    } catch {
      if (here()) mark("failed"); // after a clear the key has moved on and this is ignored
    } finally {
      moreBusy.current = false;
    }
  }, [status]);

  let view: ListView;
  const rows = getList(status);
  if (fetched?.key === key) {
    view = fetched.failed
      ? { kind: "failed" }
      : rows
        ? { kind: "ready", items: rows.items, total: rows.total, nextOffset: rows.nextOffset, refreshing: false, refreshFailed: fetched.refreshFailed, more: fetched.more }
        : { kind: "loading" }; // dropped or cleared: the refetch is already on its way
  } else {
    view = rows ? { kind: "ready", ...rows, refreshing: true, refreshFailed: false, more: "idle" } : { kind: "loading" };
  }
  return { view, retry, loadMore, announcement, clearAnnouncement, focusId, clearFocus };
}
