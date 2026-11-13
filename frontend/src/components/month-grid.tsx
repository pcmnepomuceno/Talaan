"use client";

import { useEffect, useRef, useState } from "react";
import {
  type Day,
  gridDays,
  inLimits,
  type Month,
  monthOf,
  type MoveKey,
  moveDay,
} from "../lib/calendar";
import { formatDayHeading, formatTimePht } from "../lib/format";
import type { AgendaInterview } from "../lib/types";

// DESIGN.md 6.13. A date grid (APG pattern): one tab stop, arrow keys move focus, Enter and Space
// select. The parent owns the month and the selected day; this component owns only the "active" day
// (where focus and the tab stop are), which falls back to the selected day when focus leaves.
// `days` maps a PHT day to its interviews in time order; null = no data yet (no markers, no counts).
// Moving past the visible grid, or PageUp/PageDown, asks the parent for another month (`onMonth`)
// and the focus follows to the target day as soon as the new grid has it. Day buttons are rebuilt
// when a day changes rows, so focus is put back after every move that can cause that.
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const KEYS = new Set<string>(["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]);
const LINES = 2;

const count = (n: number) => (n === 0 ? "no interviews" : n === 1 ? "1 interview" : `${n} interviews`);

export function MonthGrid({
  month,
  today,
  selected,
  days,
  labelledBy,
  onSelect,
  onMonth,
}: {
  month: Month;
  today: Day;
  selected: Day;
  days: ReadonlyMap<Day, readonly AgendaInterview[]> | null;
  labelledBy: string;
  onSelect: (day: Day) => void;
  onMonth: (month: Month, day: Day) => void;
}) {
  const grid = gridDays(month);
  const [active, setActive] = useState<Day | null>(null);
  const pending = useRef<Day | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const current = active && grid.includes(active) ? active : grid.includes(selected) ? selected : `${month}-01`;

  // Focus the day a move asked for once a grid that has it is on screen.
  useEffect(() => {
    if (pending.current === null) return;
    const el = root.current?.querySelector<HTMLElement>(`button[data-day="${pending.current}"]`);
    if (!el) return;
    pending.current = null;
    el.focus();
  });

  const go = (day: Day) => {
    pending.current = day;
    setActive(day);
  };

  function onKeyDown(e: React.KeyboardEvent<HTMLElement>, day: Day) {
    if (!KEYS.has(e.key) || e.altKey || e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    const key = e.key as MoveKey;
    // A move that has not landed yet (the month is still changing) is where the next key starts, so
    // keys pressed faster than the screen re-renders add up instead of repeating the first one.
    const from = pending.current ?? day;
    const next = moveDay(from, key);
    if (next === from) return;
    if (key === "PageUp" || key === "PageDown" || !grid.includes(next)) {
      go(next);
      onMonth(monthOf(next), next);
    } else go(next);
  }

  function choose(day: Day) {
    if (!inLimits(day)) return;
    go(day);
    onSelect(day);
  }

  const weeks = Array.from({ length: grid.length / 7 }, (_, w) => grid.slice(w * 7, w * 7 + 7));
  return (
    <div
      ref={root}
      role="grid"
      aria-labelledby={labelledBy}
      aria-busy={days === null || undefined}
      className="overflow-hidden rounded-sm border border-border-subtle bg-surface-card"
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
          pending.current = null;
          setActive(null);
        }
      }}
    >
      <div role="row" className="grid grid-cols-7">
        {WEEKDAYS.map((w) => (
          <div key={w} role="columnheader" aria-label={w} className="px-1 py-2 text-center text-caption text-text-secondary">
            {w.slice(0, 3)}
          </div>
        ))}
      </div>
      {weeks.map((week) => (
        <div key={week[0]} role="row" className="grid grid-cols-7">
          {week.map((day) => {
            const rows = days?.get(day) ?? [];
            const has = rows.length > 0;
            const isSelected = day === selected;
            const dead = !inLimits(day);
            const inMonth = monthOf(day) === month;
            const label = `${formatDayHeading(day) ?? day}${days === null ? "" : `, ${count(rows.length)}`}`;
            const tone = isSelected
              ? "bg-primary text-text-inverse"
              : has
                ? `bg-primary-tint ${inMonth ? "text-text-primary" : "text-text-secondary"}`
                : `${inMonth ? "text-text-primary" : "text-text-muted"} hover:bg-surface-subtle`;
            return (
              <div key={day} role="gridcell" aria-selected={isSelected} className="border-t border-l border-border-subtle first:border-l-0">
                <button
                  type="button"
                  data-day={day}
                  aria-label={label}
                  aria-current={day === today ? "date" : undefined}
                  aria-disabled={dead || undefined}
                  tabIndex={!dead && day === current ? 0 : -1}
                  onClick={() => choose(day)}
                  onKeyDown={(e) => onKeyDown(e, day)}
                  className={`flex min-h-11 w-full flex-col items-center justify-center border text-center focus-visible:-outline-offset-2 xl:min-h-28 xl:items-stretch xl:justify-start xl:px-2 xl:py-1 xl:text-left ${
                    day === today ? "border-primary" : "border-transparent"
                  } ${dead ? "cursor-not-allowed text-text-muted" : tone}`}
                >
                  <span data-number className={`text-body tabular-nums ${has || isSelected ? "font-semibold" : "font-normal"}`}>{Number(day.slice(8))}</span>
                  {has && (
                    <span data-lines aria-hidden="true" className="mt-1 hidden min-w-0 flex-col xl:flex">
                      {rows.slice(0, LINES).map((r) => (
                        <span key={r.id} data-line className="truncate text-caption tabular-nums">
                          {formatTimePht(r.scheduled_at) ?? "Time unavailable"} · {r.company}
                        </span>
                      ))}
                      {rows.length > LINES && (
                        <span data-more className={`text-caption ${isSelected ? "" : "text-text-secondary"}`}>
                          +{rows.length - LINES} more
                        </span>
                      )}
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
