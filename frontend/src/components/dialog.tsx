"use client";

import { type ReactNode, type Ref, useEffect, useId, useRef, useState } from "react";
import { Button } from "./button";
import { Icon } from "./icon";
import { STATUSES, type Status, StatusStamp } from "./status-stamp";

// DESIGN.md 6.8 on the native <dialog>: showModal() gives the focus trap, inert page, top layer
// and Escape. `open` is the source of truth; the parent must clear it in onClose.
// Escape is routed through onClose (default close prevented) so React state never goes stale.
// onClose fires only for closes the user started (Escape, or a native close while `open` is still
// true), never for the close that follows the parent setting `open` to false.
// Clicking the scrim does nothing: native modal dialogs do not close on backdrop clicks.
// Focus goes to the first [data-autofocus] element if any, else the browser's default, and returns
// to the element that was focused before opening.
export function Dialog({
  open,
  onClose,
  title,
  description,
  badge,
  busy = false,
  headingRef,
  children,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
  // Lets a multi-step dialog move focus to the new title (the heading takes programmatic focus only).
  headingRef?: Ref<HTMLHeadingElement>;
  title: string;
  description?: string;
  badge?: ReactNode;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const trigger = useRef<HTMLElement | null>(null);
  const wantOpen = useRef(open);
  const id = useId();

  useEffect(() => {
    wantOpen.current = open;
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      trigger.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      el.showModal();
      el.querySelector<HTMLElement>("[data-autofocus]")?.focus();
    } else if (!open && el.open) {
      el.close();
      trigger.current?.focus();
      trigger.current = null;
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={`${id}-title`}
      aria-describedby={description ? `${id}-desc` : undefined}
      aria-busy={busy || undefined}
      onCancel={(e) => {
        e.preventDefault();
        if (!busy) onClose();
      }}
      onClose={() => {
        // `el.open` also skips a stale close event that lands after a re-open.
        const el = ref.current;
        if (!wantOpen.current || !el || el.open) return;
        // Busy: undo a native close that skipped `cancel` (Chrome, a second Escape), keep the request's dialog up.
        if (busy) el.showModal();
        else onClose();
      }}
      className="m-0 mt-auto max-h-[calc(100%-2rem)] w-full max-w-none overflow-y-auto rounded-t-sheet bg-surface-card px-5 pt-6 pb-[calc(2rem+env(safe-area-inset-bottom))] text-text-primary shadow-float backdrop:bg-overlay md:m-auto md:max-w-[440px] md:rounded-sheet md:pb-8"
    >
      {badge}
      <h2 ref={headingRef} id={`${id}-title`} tabIndex={-1} className="text-section-title outline-none">
        {title}
      </h2>
      {description && (
        <p id={`${id}-desc`} className="mt-1 text-caption text-text-muted">
          {description}
        </p>
      )}
      {children}
    </dialog>
  );
}

// DESIGN.md section 8.6. Cancel gets initial focus so Enter never confirms by accident.
// `busy` (request in flight) disables both buttons and Escape, so a double-click deletes once;
// a native close while busy re-opens the dialog instead of cancelling.
export function DeleteConfirm({
  open,
  onCancel,
  onConfirm,
  title,
  message,
  confirmLabel,
  busy = false,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  title: string;
  message: string;
  confirmLabel: string;
  busy?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      busy={busy}
      title={title}
      description={message}
      badge={
        <span className="mb-4 flex size-10 items-center justify-center rounded-sm bg-error-bg text-error-text">
          <Icon name="delete" />
        </span>
      }
    >
      <div className="mt-6 flex flex-col gap-3">
        <Button variant="destructive" className="w-full" onClick={onConfirm} disabled={busy}>
          {confirmLabel}
        </Button>
        <Button variant="secondary" className="w-full" onClick={onCancel} disabled={busy} data-autofocus>
          Cancel
        </Button>
      </div>
    </Dialog>
  );
}

// DESIGN.md 6.8b. Nine radios, one per status, each labelled by its stamp. Choosing only changes the
// selection (arrow keys move native radios, so one tap per status would send a request per key);
// "Update status" sends it. The current status is checked and has initial focus; the selection
// starts from `current` on every open. `busy` blocks every control and Escape, but with
// aria-disabled and ignored input, not `disabled`: disabling the focused control drops focus to
// <body>. When busy ends with the dialog still open (the save failed), the checked radio gets focus.
export function StatusDialog({
  open,
  current,
  busy = false,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  current: Status;
  busy?: boolean;
  onCancel: () => void;
  onConfirm: (status: Status) => void;
}) {
  const [picked, setPicked] = useState(current);
  // Reset during render when the dialog opens, so the checked radio is right at the first paint
  // (the Dialog focuses [data-autofocus] in its own effect right after).
  const [wasOpen, setWasOpen] = useState(open);
  if (wasOpen !== open) {
    setWasOpen(open);
    if (open) setPicked(current);
  }
  const form = useRef<HTMLFormElement>(null);
  const wasBusy = useRef(busy);
  useEffect(() => {
    if (wasBusy.current && !busy && open) form.current?.querySelector<HTMLInputElement>("input:checked")?.focus();
    wasBusy.current = busy;
  }, [busy, open]);
  const off = busy || undefined;
  return (
    <Dialog open={open} onClose={onCancel} busy={busy} title="Change status">
      <form
        ref={form}
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!busy) onConfirm(picked);
        }}
      >
        <fieldset className="mt-3 min-w-0 border-0 p-0">
          <legend className="sr-only">Status</legend>
          {STATUSES.map((s) => (
            <label key={s} className="flex min-h-11 cursor-pointer items-center gap-3 has-aria-disabled:cursor-not-allowed">
              <input
                type="radio"
                name="status"
                value={s}
                checked={picked === s}
                onChange={() => !busy && setPicked(s)}
                aria-disabled={off}
                data-autofocus={s === current || undefined}
                className="size-5 shrink-0 accent-primary"
              />
              <StatusStamp value={s} />
            </label>
          ))}
        </fieldset>
        <div className="mt-6 flex flex-col gap-3">
          <Button type="submit" className="w-full" aria-disabled={off}>
            Update status
          </Button>
          <Button variant="secondary" className="w-full" onClick={() => !busy && onCancel()} aria-disabled={off}>
            Cancel
          </Button>
        </div>
      </form>
    </Dialog>
  );
}
