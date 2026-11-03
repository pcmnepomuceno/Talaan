"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApplications } from "@/lib/api";
import { getList, onCachesCleared, setList } from "@/lib/cache";
import type { Application, Status } from "@/lib/types";

// One status tab = one cached list, fetched 50 at a time from the server (the API pages and
// filters). Cached rows show at once while page 1 is refetched; the fresh page 1 then REPLACES the
// entry, dropping any extra pages the user had loaded, because their offsets may have shifted.
// Any write (clearCaches) empties the cache and refetches the current tab.
export type ListView =
  | { kind: "loading" }
  | { kind: "failed" }
  | {
      kind: "ready";
      items: Application[];
      total: number;
      refreshing: boolean; // showing cached rows while page 1 is refetched
      refreshFailed: boolean; // showing cached rows, the background refetch failed
      more: "idle" | "loading" | "failed";
    };

type Fetched = { key: string; items: Application[]; total: number; failed: boolean; refreshFailed: boolean; more: "idle" | "loading" | "failed" };

/** Adds `incoming` rows whose id is not already present, in order. */
export function appendUnique(existing: Application[], incoming: Application[]): Application[] {
  const seen = new Set(existing.map((a) => a.id));
  return [...existing, ...incoming.filter((a) => !seen.has(a.id))];
}

export function useApplicationList(status: Status | undefined) {
  const [tick, setTick] = useState(0);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const key = `${status ?? "all"}:${tick}`;
  const keyRef = useRef(key);
  useEffect(() => {
    keyRef.current = key;
  });
  const moreBusy = useRef(false);

  useEffect(() => onCachesCleared(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    let live = true;
    const cached = getList(status);
    getApplications(status).then(
      (page) => {
        // Only a live request may write the cache: a write or tab switch since then makes it stale.
        if (!live) return;
        setList(status, page);
        setFetched({ key, ...page, failed: false, refreshFailed: false, more: "idle" });
      },
      () => {
        if (live) setFetched({ key, items: cached?.items ?? [], total: cached?.total ?? 0, failed: !cached, refreshFailed: !!cached, more: "idle" });
      },
    );
    return () => {
      live = false;
    };
  }, [status, key]);

  const retry = useCallback(() => {
    setFetched(null);
    setTick((n) => n + 1);
  }, []);

  const loadMore = useCallback(async () => {
    const at = keyRef.current;
    const cur = getList(status);
    if (!cur || moreBusy.current) return;
    moreBusy.current = true;
    setAnnouncement("");
    setFetched((f) => (f && f.key === at ? { ...f, more: "loading" } : f));
    try {
      const page = await getApplications(status, cur.items.length);
      if (keyRef.current !== at) return;
      const items = appendUnique(cur.items, page.items);
      const added = items.length - cur.items.length;
      setList(status, { items, total: page.total });
      setFetched((f) => (f && f.key === at ? { ...f, items, total: page.total, more: "idle" } : f));
      if (added > 0) {
        setAnnouncement(`${added} more ${added === 1 ? "application" : "applications"} loaded`);
        setFocusId(items[cur.items.length].id);
      }
    } catch {
      if (keyRef.current === at) setFetched((f) => (f && f.key === at ? { ...f, more: "failed" } : f));
    } finally {
      moreBusy.current = false;
    }
  }, [status]);

  let view: ListView;
  if (fetched?.key === key) {
    view = fetched.failed
      ? { kind: "failed" }
      : { kind: "ready", items: fetched.items, total: fetched.total, refreshing: false, refreshFailed: fetched.refreshFailed, more: fetched.more };
  } else {
    const cached = getList(status);
    view = cached ? { kind: "ready", ...cached, refreshing: true, refreshFailed: false, more: "idle" } : { kind: "loading" };
  }
  return { view, retry, loadMore, announcement, focusId, clearFocus: () => setFocusId(null) };
}
