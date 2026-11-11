"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ANNOUNCE_MS, appendUnique } from "@/app/(app)/applications/(ledger)/use-list";
import { getAgenda } from "@/lib/api";
import { type AgendaKey, agendaVersion, getAgenda as cached, onCachesCleared, setAgenda } from "@/lib/cache";
import type { AgendaInterview } from "@/lib/types";

// One tab (Upcoming or Past) = one cached list, 50 rows a page from the server. Cached rows show at
// once while page 1 is refetched; the fresh page 1 then REPLACES the entry (extra pages loaded before
// are dropped, their offsets may have shifted). Any cache clear (an interview or application write,
// an auth event: cache.ts) refetches the tab on screen; a response requested before a clear is dropped
// (agendaVersion). There is no status-write window here: a status change never alters an agenda row.
// Load more asks for nextOffset (rows the server has sent) at page 1's asOf (so the upcoming/past
// boundary cannot move between pages), and a page that adds no new row withdraws
// Load more and refetches page 1. Same shape as use-list.ts.
export type AgendaView =
  | { kind: "loading" }
  | { kind: "failed" }
  | {
      kind: "ready";
      items: AgendaInterview[];
      total: number;
      nextOffset: number;
      refreshing: boolean; // showing cached rows while page 1 is refetched
      refreshFailed: boolean; // showing cached rows, the background refetch failed
      more: "idle" | "loading" | "failed";
    };

type Fetched = { key: string; failed: boolean; refreshFailed: boolean; more: "idle" | "loading" | "failed" };

export function useAgenda(when: AgendaKey) {
  const [tick, setTick] = useState(0);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [focusId, setFocusId] = useState<number | null>(null);
  const key = `${when}:${tick}`;

  // The live region falls back to this text after every loading message, so it must not outlive the
  // moment it describes: cleared on a tab switch or refetch (new key) and after ANNOUNCE_MS.
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

  // Every clear (with or without an application id) drops the agenda: refetch the tab on screen.
  useEffect(() => onCachesCleared(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    let live = true;
    const v = agendaVersion();
    getAgenda(when).then(
      (page) => {
        // Requested before a clear: the clear already queued a refetch, so this answer is just dropped.
        if (!live || v !== agendaVersion()) return;
        setAgenda(when, { ...page, nextOffset: page.items.length }); // page 1: a fresh asOf
        setFetched({ key, failed: false, refreshFailed: false, more: "idle" });
      },
      () => {
        if (!live || v !== agendaVersion()) return;
        const had = !!cached(when);
        setFetched({ key, failed: !had, refreshFailed: had, more: "idle" });
      },
    );
    return () => {
      live = false;
    };
  }, [when, key]);

  const clearFocus = useCallback(() => setFocusId(null), []);

  const retry = useCallback(() => {
    setFetched(null);
    setTick((n) => n + 1);
  }, []);

  const loadMore = useCallback(async () => {
    const at = keyRef.current;
    const cur = cached(when);
    if (!cur || moreBusy.current) return;
    moreBusy.current = true;
    setAnnouncement("");
    const v = agendaVersion();
    const mark = (more: Fetched["more"]) => setFetched((f) => (f && f.key === at ? { ...f, more } : f));
    const here = () => mounted.current && keyRef.current === at && v === agendaVersion();
    mark("loading");
    try {
      const page = await getAgenda(when, cur.nextOffset, cur.asOf);
      if (!here()) return; // a clear in between: its refetch replaces everything
      const items = appendUnique(cur.items, page.items);
      const added = items.length - cur.items.length;
      if (added === 0) {
        // Nothing new: the offsets shifted under us. Stop offering Load more (nextOffset = total) and
        // refetch page 1, which replaces this entry with a fresh start.
        setAgenda(when, { items, total: page.total, nextOffset: page.total, asOf: cur.asOf });
        setTick((n) => n + 1);
        return;
      }
      setAgenda(when, { items, total: page.total, nextOffset: cur.nextOffset + page.items.length, asOf: cur.asOf });
      mark("idle");
      setAnnouncement(`${added} more ${added === 1 ? "interview" : "interviews"} loaded`);
      setFocusId(items[cur.items.length].id);
    } catch {
      if (here()) mark("failed");
    } finally {
      moreBusy.current = false;
    }
  }, [when]);

  let view: AgendaView;
  const rows = cached(when);
  if (fetched?.key === key) {
    view = fetched.failed
      ? { kind: "failed" }
      : rows
        ? { kind: "ready", items: rows.items, total: rows.total, nextOffset: rows.nextOffset, refreshing: false, refreshFailed: fetched.refreshFailed, more: fetched.more }
        : { kind: "loading" }; // cleared: the refetch is already on its way
  } else {
    view = rows ? { kind: "ready", ...rows, refreshing: true, refreshFailed: false, more: "idle" } : { kind: "loading" };
  }
  return { view, retry, loadMore, announcement, focusId, clearFocus };
}
