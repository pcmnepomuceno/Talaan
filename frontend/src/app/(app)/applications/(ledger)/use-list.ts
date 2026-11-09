"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApplications } from "@/lib/api";
import { cacheVersion, getList, onCachesCleared, setList } from "@/lib/cache";
import type { Application, Status } from "@/lib/types";

// One status tab = one cached list, fetched 50 at a time from the server (the API pages and
// filters). Cached rows show at once while page 1 is refetched; the fresh page 1 then REPLACES the
// entry, dropping any extra pages the user had loaded, because their offsets may have shifted.
// Any write (clearCaches) empties the cache and refetches the current tab. Load more asks for
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

type Fetched = { key: string; items: Application[]; total: number; nextOffset: number; failed: boolean; refreshFailed: boolean; more: "idle" | "loading" | "failed" };

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

  // Only a full clear refetches: an interview write clears one detail (an id is passed) and no list row changes.
  useEffect(() => onCachesCleared((id) => id === undefined && setTick((n) => n + 1)), []);

  useEffect(() => {
    let live = true;
    const v = cacheVersion();
    const cached = getList(status);
    getApplications(status).then(
      (page) => {
        // Only a live request from the current cache version may write the cache: a write or tab
        // switch since it started makes it stale (`live` alone misses one landing before a re-render).
        if (!live || cacheVersion() !== v) return;
        const entry = { ...page, nextOffset: page.items.length };
        setList(status, entry);
        setFetched({ key, ...entry, failed: false, refreshFailed: false, more: "idle" });
      },
      () => {
        if (live && cacheVersion() === v)
          setFetched({
            key,
            items: cached?.items ?? [],
            total: cached?.total ?? 0,
            nextOffset: cached?.nextOffset ?? 0,
            failed: !cached,
            refreshFailed: !!cached,
            more: "idle",
          });
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
    const v = cacheVersion();
    const cur = getList(status);
    if (!cur || moreBusy.current) return;
    moreBusy.current = true;
    setAnnouncement("");
    setFetched((f) => (f && f.key === at ? { ...f, more: "loading" } : f));
    try {
      const page = await getApplications(status, cur.nextOffset);
      if (keyRef.current !== at || cacheVersion() !== v) return;
      const items = appendUnique(cur.items, page.items);
      const added = items.length - cur.items.length;
      if (added === 0) {
        // Nothing new: the offsets shifted under us. Stop offering Load more (nextOffset = total)
        // and refetch page 1, which replaces this entry with a fresh start.
        setList(status, { items, total: page.total, nextOffset: page.total });
        setTick((n) => n + 1);
        return;
      }
      const nextOffset = cur.nextOffset + page.items.length;
      setList(status, { items, total: page.total, nextOffset });
      setFetched((f) => (f && f.key === at ? { ...f, items, total: page.total, nextOffset, more: "idle" } : f));
      setAnnouncement(`${added} more ${added === 1 ? "application" : "applications"} loaded`);
      setFocusId(items[cur.items.length].id);
    } catch {
      if (keyRef.current === at && cacheVersion() === v) setFetched((f) => (f && f.key === at ? { ...f, more: "failed" } : f));
    } finally {
      moreBusy.current = false;
    }
  }, [status]);

  let view: ListView;
  if (fetched?.key === key) {
    view = fetched.failed
      ? { kind: "failed" }
      : { kind: "ready", items: fetched.items, total: fetched.total, nextOffset: fetched.nextOffset, refreshing: false, refreshFailed: fetched.refreshFailed, more: fetched.more };
  } else {
    const cached = getList(status);
    view = cached ? { kind: "ready", ...cached, refreshing: true, refreshFailed: false, more: "idle" } : { kind: "loading" };
  }
  return { view, retry, loadMore, announcement, clearAnnouncement, focusId, clearFocus };
}
