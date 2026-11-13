"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef } from "react";
import { AppBar } from "@/components/app-bar";
import { Button } from "@/components/button";
import { AddToCalendar, CalendarGuide } from "@/components/calendar";
import { EmptyState } from "@/components/empty-state";
import { AgendaRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { SegmentedControl } from "@/components/segmented-control";
import { WakingUp } from "@/components/waking-up";
import { monthOf, phtToday } from "@/lib/calendar";
import { type AgendaKey, loadedOnce } from "@/lib/cache";
import { formatDayHeading } from "@/lib/format";
import { groupByPhtDay } from "@/lib/interviews";
import { MonthView } from "./month-view";
import { useAgenda } from "./use-agenda";

const TABS = [
  { value: "upcoming", label: "Upcoming" },
  { value: "past", label: "Past" },
] as const satisfies readonly { value: AgendaKey; label: string }[];

const VIEWS = [
  { value: "agenda", label: "Agenda" },
  { value: "month", label: "Month" },
] as const;

// DESIGN.md 8.8. The screen is a header (title, import guide, View switch kept in `?view=month`) over
// one of two views. Agenda: a single column, interviews grouped by Philippine day, one ledger sheet
// per day, Upcoming (oldest first) or Past (newest first) kept in `?when=past`. Month: the calendar
// grid (month-view.tsx). The header stays mounted across a switch, so the focused View radio keeps focus.
export function AgendaScreen() {
  const router = useRouter();
  const month = useSearchParams().get("view") === "month";
  return (
    <>
      <AppBar />
      <main
        id="content"
        tabIndex={-1}
        className={`mx-auto px-4 pt-4 pb-[calc(6rem+env(safe-area-inset-bottom))] outline-none md:pb-24 xl:pt-8 ${month ? "max-w-[640px] xl:max-w-[960px]" : "max-w-[640px]"}`}
      >
        <div className="flex min-h-11 flex-wrap items-center justify-between gap-x-3">
          <h1 className="text-section-title text-text-primary">Interviews</h1>
          <div className="-mr-2">
            <CalendarGuide />
          </div>
        </div>
        <div className="mt-3 md:max-w-80">
          <SegmentedControl
            label="View"
            hideLabel
            options={VIEWS}
            value={month ? "month" : "agenda"}
            onChange={(v) => router.replace(v === "month" ? `/interviews?view=month&month=${monthOf(phtToday())}` : "/interviews")}
          />
        </div>
        {month ? <MonthView /> : <AgendaBody />}
      </main>
    </>
  );
}

function AgendaBody() {
  const router = useRouter();
  const when: AgendaKey = useSearchParams().get("when") === "past" ? "past" : "upcoming";
  const { view, retry, loadMore, announcement, focusId, clearFocus } = useAgenda(when);
  const listRef = useRef<HTMLDivElement>(null);

  // After "Load more" the button may disappear (end of list): focus the first new row instead.
  useEffect(() => {
    if (focusId === null) return;
    listRef.current?.querySelector<HTMLElement>(`a[data-interview-id="${focusId}"]`)?.focus();
    clearFocus();
  }, [focusId, clearFocus]);

  // Only while there is nothing to show yet: never for a reload after a cache clear.
  const wakePending = view.kind === "loading" && !loadedOnce();

  return (
    <>
      {/* Always mounted, so changes are announced (a region added together with its text often is not). */}
      <div role="status" className="sr-only">
        {view.kind === "loading" ? "Loading interviews" : announcement}
      </div>
      <WakingUp pending={wakePending} />
      <div className="mt-3 md:max-w-80">
        <SegmentedControl
          label="Show"
          hideLabel
          options={TABS}
          value={when}
          onChange={(v) => router.replace(v === "upcoming" ? "/interviews" : `/interviews?when=${v}`)}
        />
      </div>
      <div className="mt-4" ref={listRef}>
        {view.kind === "loading" ? (
          <LedgerSkeleton silent />
        ) : view.kind === "failed" ? (
          <LoadError title="Couldn't load interviews." onRetry={retry} />
        ) : view.total === 0 ? (
          <EmptyState
            title={when === "upcoming" ? "No upcoming interviews." : "No past interviews."}
            message="Interviews are added from an application."
            action={
              <Button variant="secondary" href="/applications">
                Go to applications
              </Button>
            }
          />
        ) : (
          <>
            {view.refreshFailed && (
              <div className="mb-3">
                <LoadError title="Couldn't refresh the interviews. Showing the last loaded rows." onRetry={retry} />
              </div>
            )}
            {groupByPhtDay(view.items).map((g, n) => {
              const heading = formatDayHeading(g.day) ?? "Date unavailable";
              const id = `day-${g.day || "unknown"}`;
              return (
                <section key={g.day} aria-labelledby={id} className={n > 0 ? "mt-6" : undefined}>
                  <h2 id={id} className="mb-2 text-body-medium text-text-secondary">
                    {heading}
                  </h2>
                  <LedgerSheet>
                    {g.items.map((i) => (
                      <AgendaRow key={i.id} interview={i} action={when === "upcoming" ? <AddToCalendar interview={i} disabled={view.refreshing} /> : undefined} />
                    ))}
                  </LedgerSheet>
                </section>
              );
            })}
            {view.nextOffset < view.total && (
              <div className="mt-3 flex flex-col items-center gap-3">
                {view.more === "failed" ? (
                  <LoadError title="Couldn't load more interviews." onRetry={loadMore} />
                ) : (
                  <Button
                    variant="secondary"
                    onClick={loadMore}
                    disabled={view.more === "loading" || view.refreshing}
                    aria-busy={view.more === "loading" || undefined}
                  >
                    {view.more === "loading" ? "Loading…" : "Load more"}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </>
  );
}
