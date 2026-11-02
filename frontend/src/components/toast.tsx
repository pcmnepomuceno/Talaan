"use client";

import { createContext, type ReactNode, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Icon } from "./icon";

// DESIGN.md 6.9. Two always-mounted live regions (a region added together with its content is
// often not announced): polite `status` for success, assertive `alert` for errors.
// Success auto-dismisses after 4s; the timer pauses while hovered or focused. Errors stay.
// Caps are per kind: at most 3 successes and 3 errors; a 4th drops the oldest of its own kind,
// so a burst of errors can never hide a new success.
// Dismissing the focused toast moves focus to the next toast's Dismiss button, else back to the
// element focused before focus entered the toasts, so it never falls to <body>.
// No enter or exit animation, so reduced motion needs no special case.
const SUCCESS_MS = 4000;
const MAX = 3;

type Kind = "success" | "error";
type Item = { id: number; kind: Kind; message: string };
type Dismiss = (id: number, button?: HTMLElement) => void;
type Api = { success: (message: string) => void; error: (message: string) => void };

const ToastContext = createContext<Api | null>(null);

export function useToast(): Api {
  const api = useContext(ToastContext);
  if (!api) throw new Error("useToast must be used inside <ToastProvider>");
  return api;
}

// Toasts arrive one at a time, so at most one is over the cap.
function trim(items: Item[], kind: Kind): Item[] {
  const same = items.filter((t) => t.kind === kind);
  return same.length > MAX ? items.filter((t) => t !== same[0]) : items;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Item[]>([]);
  const nextId = useRef(0);
  const stack = useRef<HTMLDivElement>(null);
  const returnTo = useRef<HTMLElement | null>(null);

  const add = useCallback((kind: Kind, message: string) => {
    const id = nextId.current++; // outside the updater: two calls in one tick still get two ids
    setItems((prev) => trim([...prev, { id, kind, message }], kind));
  }, []);
  // `button` is passed only when that toast's Dismiss button had focus.
  const dismiss = useCallback<Dismiss>((id, button) => {
    if (button) {
      const all = [...(stack.current?.querySelectorAll<HTMLElement>("[data-dismiss]") ?? [])];
      const next = all[all.indexOf(button) + 1] ?? returnTo.current;
      if (next?.isConnected) next.focus();
    }
    setItems((prev) => prev.filter((t) => t.id !== id));
  }, []);
  const api = useMemo<Api>(
    () => ({ success: (m) => add("success", m), error: (m) => add("error", m) }),
    [add],
  );

  const region = (kind: Kind, role: "status" | "alert") => (
    <div role={role} className="pointer-events-none flex flex-col gap-2">
      {items
        .filter((t) => t.kind === kind)
        .map((t) => (
          <ToastView key={t.id} item={t} onDismiss={dismiss} />
        ))}
    </div>
  );

  return (
    <ToastContext value={api}>
      {children}
      <div
        ref={stack}
        onFocus={(e) => {
          const from = e.relatedTarget;
          if (from instanceof HTMLElement && !stack.current?.contains(from)) returnTo.current = from;
        }}
        className="pointer-events-none fixed inset-x-0 bottom-0 z-50 mx-auto flex max-w-[440px] flex-col gap-2 px-4 pb-[calc(1rem+env(safe-area-inset-bottom)+var(--bottom-nav,0px))]"
      >
        {region("error", "alert")}
        {region("success", "status")}
      </div>
    </ToastContext>
  );
}

function ToastView({ item, onDismiss }: { item: Item; onDismiss: Dismiss }) {
  const [hover, setHover] = useState(false);
  const [focus, setFocus] = useState(false);
  const paused = hover || focus;
  const remaining = useRef(SUCCESS_MS);

  useEffect(() => {
    if (item.kind !== "success" || paused) return;
    const start = Date.now();
    const timer = setTimeout(() => onDismiss(item.id), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - start;
    };
  }, [item.kind, item.id, paused, onDismiss]);

  const ok = item.kind === "success";
  return (
    <div
      // Mouse only: a touch tap fires an emulated mouseenter with no leave, which would pause forever.
      onPointerEnter={(e) => e.pointerType === "mouse" && setHover(true)}
      onPointerLeave={(e) => e.pointerType === "mouse" && setHover(false)}
      onFocus={() => setFocus(true)}
      onBlur={() => setFocus(false)}
      className={`pointer-events-auto flex min-h-12 items-center gap-2 rounded-sm border py-1 pr-1 pl-4 shadow-float ${
        ok
          ? "border-success-border bg-success-bg text-success-text"
          : "border-error-border bg-error-bg text-error-text"
      }`}
    >
      <Icon name={ok ? "check" : "error"} />
      <p className="min-w-0 flex-1 py-2 text-body-medium [overflow-wrap:anywhere]">{item.message}</p>
      <button
        type="button"
        aria-label="Dismiss notification"
        data-dismiss
        onClick={(e) => onDismiss(item.id, document.activeElement === e.currentTarget ? e.currentTarget : undefined)}
        className="flex size-11 shrink-0 items-center justify-center rounded-sm"
      >
        <Icon name="close" />
      </button>
    </div>
  );
}
