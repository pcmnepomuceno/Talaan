"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ANNOUNCE_MS } from "@/app/(app)/applications/(ledger)/use-list";
import { Banner } from "@/components/banner";
import { TextAction } from "@/components/button";
import { AddToCalendar } from "@/components/calendar";
import { Icon } from "@/components/icon";
import { AgendaRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { MonthGrid } from "@/components/month-grid";
import { WakingUp } from "@/components/waking-up";
import {
  addMonths,
  type Day,
  formatMonthHeading,
  gridRange,
  MAX_MONTH,
  MIN_MONTH,
  type Month,
  monthOf,
  parseDay,
  parseMonth,
  phtToday,
} from "@/lib/calendar";
import { loadedOnce } from "@/lib/cache";
import { formatDayHeading } from "@/lib/format";
import { groupByPhtDay, isUpcoming } from "@/lib/interviews";
import type { AgendaInterview } from "@/lib/types";
import { useCalendar } from "./use-calendar";

// DESIGN.md 6.13 and 8.8. State lives in the URL (?view=month&month=YYYY-MM&day=YYYY-MM-DD) and every
// change replaces the history entry, so Back leaves the screen instead of stepping through months.
export const monthHref = (month: Month, day?: Day) => `/interviews?view=month&month=${month}${day ? `&day=${day}` : ""}`;

const nav =
  "inline-flex size-11 items-center justify-center rounded-sm text-primary hover:bg-primary-tint aria-disabled:cursor-not-allowed aria-disabled:text-text-muted aria-disabled:hover:bg-transparent";

export function MonthView() {
  const router = useRouter();
  const params = useSearchParams();
  const today = phtToday();
  const { month, valid } = parseMonth(params.get("month"), today);
  const selected = parseDay(params.get("day"), month, today);
  const { from, to } = gridRange(month);
  const { view, retry } = useCalendar(from, to);
  const headingId = useId();
  const dayId = useId();
  const [announcement, setAnnouncement] = useState("");

  // A missing or invalid ?month becomes the current month in the URL (it is already shown meanwhile).
  useEffect(() => {
    if (!valid) router.replace(monthHref(month));
  }, [valid, month, router]);

  useEffect(() => {
    if (!announcement) return;
    const t = setTimeout(() => setAnnouncement(""), ANNOUNCE_MS);
    return () => clearTimeout(t);
  }, [announcement]);

  // Previous/Next read the month last asked for, so presses faster than the URL can update still add up.
  // ponytail: a press between the URL catching up halfway and the last update starts from the middle month.
  const target = useRef(month);
  useEffect(() => {
    target.current = month;
  }, [month]);

  function go(next: Month, day?: Day) {
    target.current = next;
    setAnnouncement(formatMonthHeading(next));
    router.replace(monthHref(next, day));
  }
  const step = (n: number) => {
    const next = addMonths(target.current, n);
    if (next >= MIN_MONTH && next <= MAX_MONTH) go(next);
  };

  const days = useMemo(() => {
    if (view.kind !== "ready") return null;
    return new Map(groupByPhtDay(view.items).map((g) => [g.day, g.items] as const));
  }, [view]);
  const dayRows: readonly AgendaInterview[] = days?.get(selected) ?? [];

  const wakePending = view.kind === "loading" && !loadedOnce();
  const atMin = month <= MIN_MONTH;
  const atMax = month >= MAX_MONTH;

  return (
    <>
      {/* Always mounted, so changes are announced (a region added together with its text often is not). */}
      <div role="status" className="sr-only">
        {view.kind === "loading" ? "Loading interviews" : announcement}
      </div>
      <WakingUp pending={wakePending} />
      <div className="mt-4 flex min-h-11 items-center justify-between gap-2">
        <h2 id={headingId} className="text-section-title text-text-primary">
          {formatMonthHeading(month)}
        </h2>
        <div className="-mr-2 flex items-center">
          <button type="button" aria-label="Previous month" aria-disabled={atMin || undefined} onClick={() => !atMin && step(-1)} className={nav}>
            <Icon name="chevron_left" />
          </button>
          <button type="button" aria-label="Next month" aria-disabled={atMax || undefined} onClick={() => !atMax && step(1)} className={nav}>
            <Icon name="chevron_right" />
          </button>
          <TextAction onClick={() => go(monthOf(today))}>Today</TextAction>
        </div>
      </div>
      {view.kind === "ready" && view.truncated && (
        <div className="mt-3">
          <Banner title="Showing the first 200 interviews. Some are not shown." />
        </div>
      )}
      <div className="mt-3">
        <MonthGrid
          month={month}
          today={today}
          selected={selected}
          days={days}
          labelledBy={headingId}
          onSelect={(d) => {
            if (monthOf(d) !== month) setAnnouncement(formatMonthHeading(monthOf(d)));
            target.current = monthOf(d);
            router.replace(monthHref(monthOf(d), d));
          }}
          onMonth={(m) => go(m)}
        />
      </div>
      {view.kind === "failed" && (
        <div className="mt-3">
          <LoadError title="Couldn't load interviews." onRetry={retry} />
        </div>
      )}
      {view.kind === "ready" && view.refreshFailed && (
        <div className="mt-3">
          <LoadError title="Couldn't refresh the interviews. Showing the last loaded rows." onRetry={retry} />
        </div>
      )}
      {view.kind !== "failed" && (
        <section aria-labelledby={dayId} className="mt-6">
          <h3 id={dayId} className="mb-2 text-body-medium text-text-secondary">
            {formatDayHeading(selected)}
          </h3>
          {view.kind === "loading" ? (
            <LedgerSkeleton rows={2} silent />
          ) : dayRows.length === 0 ? (
            <p className="text-caption text-text-muted">No interviews on this day.</p>
          ) : (
            <LedgerSheet>
              {dayRows.map((i) => (
                <AgendaRow key={i.id} interview={i} action={isUpcoming(i) ? <AddToCalendar interview={i} disabled={view.kind === "ready" && view.refreshing} /> : undefined} />
              ))}
            </LedgerSheet>
          )}
        </section>
      )}
    </>
  );
}
