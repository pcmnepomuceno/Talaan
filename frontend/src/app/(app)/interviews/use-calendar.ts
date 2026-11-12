"use client";

import { useCallback, useEffect, useState } from "react";
import { getCalendarRange } from "@/lib/api";
import { agendaVersion, calendarKey, type CalendarEntry, getCalendar, onCachesCleared, setCalendar } from "@/lib/cache";

// The month view's data: the interviews of one visible grid (`from`..`to`, PHT days), one cache entry
// per range. Cached rows show at once while the range is refetched. Any cache clear (an interview or
// application write, an auth event: cache.ts) refetches the range on screen; a response is dropped
// when it was requested before a clear (agendaVersion) or for a range no longer shown (the effect's
// cleanup), so fast Previous/Next presses cannot land an old month on a new one. No paging: the server
// caps the range at 200 rows and says so (`truncated`).
export type CalendarView =
  | { kind: "loading" }
  | { kind: "failed" }
  | ({ kind: "ready"; refreshing: boolean; refreshFailed: boolean } & CalendarEntry);

type Fetched = { key: string; tick: number; failed: boolean; refreshFailed: boolean };

export function useCalendar(from: string, to: string) {
  const key = calendarKey(from, to);
  const [tick, setTick] = useState(0);
  const [fetched, setFetched] = useState<Fetched | null>(null);

  useEffect(() => onCachesCleared(() => setTick((n) => n + 1)), []);

  useEffect(() => {
    let live = true;
    const v = agendaVersion();
    getCalendarRange(from, to).then(
      (r) => {
        if (!live || v !== agendaVersion()) return; // a clear queued its own refetch
        setCalendar(key, { items: r.items, total: r.total, truncated: r.truncated });
        setFetched({ key, tick, failed: false, refreshFailed: false });
      },
      () => {
        if (!live || v !== agendaVersion()) return;
        const had = !!getCalendar(key);
        setFetched({ key, tick, failed: !had, refreshFailed: had });
      },
    );
    return () => {
      live = false;
    };
  }, [from, to, key, tick]);

  const retry = useCallback(() => {
    setFetched(null);
    setTick((n) => n + 1);
  }, []);

  const entry = getCalendar(key);
  const done = fetched?.key === key && fetched.tick === tick;
  let view: CalendarView;
  if (done && fetched.failed) view = { kind: "failed" };
  else if (entry) view = { kind: "ready", ...entry, refreshing: !done, refreshFailed: done && fetched.refreshFailed };
  else view = { kind: "loading" };
  return { view, retry };
}
