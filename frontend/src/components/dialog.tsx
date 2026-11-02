"use client";

import { type ReactNode, useEffect, useId, useRef } from "react";
import { Button } from "./button";
import { Icon } from "./icon";

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
  children,
}: {
  open: boolean;
  onClose: () => void;
  busy?: boolean;
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
      <h2 id={`${id}-title`} className="text-section-title">
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
