"use client";

import { useEffect, useRef, useState } from "react";
import { STATUSES, type Status, stampLabel } from "./status-stamp";

export type Filter = Status | "all";
const filters: Filter[] = ["all", ...STATUSES];

// DESIGN.md 6.4. Toggle buttons (aria-pressed), label only. Under 768: one row that scrolls
// sideways (scrollbar hidden, keyboard-scrollable by focus, right-edge fade while more is hidden).
// From 768: wraps onto more rows, no scrollbar.
// The visible tab is 36px; the button around it is 44px tall for the touch target, and the
// focus ring sits on the visible tab.
export function FilterTabs({ value, onChange }: { value: Filter; onChange: (value: Filter) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  // The fade shows while more tabs are hidden to the right. Measured on scroll and whenever the
  // row or any tab changes size (window resize, and the webfont swapping in and widening the tabs).
  useEffect(() => {
    const el = row.current;
    if (!el) return;
    const update = () => setMore(el.scrollLeft + el.clientWidth < el.scrollWidth - 5); // the row has 4px end padding
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(update);
    ro?.observe(el);
    el.querySelectorAll("button").forEach((b) => ro?.observe(b));
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
    };
  }, []);

  // Keep the pressed tab inside the row (a ?status= deep link can put it off-screen). The first
  // placement and reduced motion are instant; later changes glide. `placed` is state, not a ref
  // mutated in the effect, so StrictMode's double run sees the same value both times (dev = prod).
  const [placed, setPlaced] = useState<Filter | null>(null);
  useEffect(() => {
    if (placed === value) return;
    const active = row.current?.querySelector<HTMLElement>('[aria-pressed="true"]');
    const still = placed === null || window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    active?.scrollIntoView?.({ inline: "nearest", block: "nearest", behavior: still ? "instant" : "smooth" });
    // One extra render, once per value: the state is how StrictMode's second effect run knows nothing was placed yet.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPlaced(value);
  }, [value, placed]);
  return (
    <div
      ref={row}
      role="group"
      aria-label="Filter by status"
      className={`-mx-1 flex scroll-px-10 gap-x-2 overflow-x-auto p-1 [scrollbar-width:none] md:flex-wrap md:overflow-visible [&::-webkit-scrollbar]:hidden ${
        more ? "max-md:[mask-image:linear-gradient(to_right,black_calc(100%-32px),transparent)]" : ""
      }`}
    >
      {filters.map((f) => {
        const active = f === value;
        return (
          <button
            key={f}
            type="button"
            aria-pressed={active}
            onClick={() => onChange(f)}
            className="group flex h-11 min-w-11 shrink-0 items-center outline-none"
          >
            <span
              className={`flex h-9 w-full items-center justify-center rounded-sm border px-3.5 text-stamp-label whitespace-nowrap transition-colors duration-100 group-focus-visible:outline-2 group-focus-visible:outline-offset-2 group-focus-visible:outline-focus-ring ${
                active
                  ? "border-primary bg-primary text-text-inverse"
                  : "border-border-subtle bg-surface-card text-text-secondary group-hover:border-border-input"
              }`}
            >
              {f === "all" ? "All" : stampLabel(f)}
            </span>
          </button>
        );
      })}
    </div>
  );
}
