"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, TextAction } from "@/components/button";
import { DeleteConfirm, StatusDialog } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { LoadError } from "@/components/load-error";
import { DetailRows, InterviewRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { NotFoundState } from "@/components/not-found-state";
import { changeStatus, deleteInterview, parseStatus } from "@/lib/api";
import { formatDateTimePHT } from "@/lib/format";
import { ApiError, errorMessage } from "@/lib/http";
import type { Interview, Status } from "@/lib/types";
import { StatusStamp } from "@/components/status-stamp";
import { interviewDeleteMessage, sortInterviewsByDate } from "@/lib/interviews";
import { useDetail } from "../screen";

const heading = "mb-2 text-section-title text-text-secondary";

export function ApplicationDetail() {
  const state = useDetail();
  const toast = useToast();
  const status = parseStatus(useSearchParams().get("status"));
  const qs = status ? `?status=${status}` : "";
  const [deleting, setDeleting] = useState<Interview | null>(null);
  const [busy, setBusy] = useState(false);
  // After a confirmed delete the Delete button that opened the dialog is gone, so the Dialog's focus
  // return lands on <body>. This effect runs after the Dialog's (child effects first) and wins.
  const focusAfterDelete = useRef(false);
  const ivHeading = useRef<HTMLHeadingElement>(null);
  const emptyAdd = useRef<HTMLAnchorElement>(null);
  useEffect(() => {
    if (!focusAfterDelete.current) return;
    focusAfterDelete.current = false;
    (emptyAdd.current ?? ivHeading.current)?.focus();
  });

  // Status change. Focus goes back to Change status. When the PATCH response could not be mapped the
  // caches are cleared instead (skeleton, then a refetch) and the button remounts disabled, so the
  // Dialog's own focus return fails; this effect focuses it once it is back and enabled.
  const [changing, setChanging] = useState(false);
  const [statusBusy, setStatusBusy] = useState(false);
  const savingStatus = useRef(false); // a ref: two clicks in one tick both see the same stale state
  const focusAfterStatus = useRef(false);
  const statusBtn = useRef<HTMLButtonElement>(null);
  // A cache clear (a no-answer or unmappable save, a 404, any write elsewhere) drops this component to
  // the skeleton without unmounting it, so `changing` would survive into a later load and reopen the
  // dialog unasked. Anything but a ready detail closes it (adjusted during render, React's pattern for
  // state derived from props). A replaceDetail() keeps "ready", so the dialog stays open then.
  if (changing && state.kind !== "ready") setChanging(false);
  useEffect(() => {
    if (!focusAfterStatus.current) return;
    if (state.kind === "error" || state.kind === "missing") focusAfterStatus.current = false;
    else if (state.kind === "ready" && !state.refreshing) {
      focusAfterStatus.current = false;
      statusBtn.current?.focus();
    }
  });

  // The screen's persistent live region announces "Loading application"; the skeleton is visual only.
  if (state.kind === "removed") return null;
  if (state.kind === "loading") return <LedgerSkeleton rows={2} silent />;
  if (state.kind === "error") return <LoadError title="Couldn't load this application." onRetry={state.retry} />;
  if (state.kind === "missing") return <NotFoundState qs={qs} />;
  const { application: a, interviews: iv } = state;
  const when = (i: Interview) => formatDateTimePHT(i.scheduled_at) ?? "date unavailable";
  const addHref = `/applications/${a.id}/interviews/new${qs}`;

  async function confirmDelete() {
    if (!deleting) return;
    const target = deleting;
    setBusy(true);
    try {
      await deleteInterview(a.id, target.id); // 404 resolves too: already gone is what we wanted
    } catch {
      toast.error("Couldn't delete the interview. Try again."); // the dialog stays open
      return;
    } finally {
      setBusy(false);
    }
    setDeleting(null);
    focusAfterDelete.current = true; // read by the effect after this render
    toast.success("Interview deleted.");
  }

  async function confirmStatus(next: Status) {
    if (savingStatus.current) return;
    if (next === a.status) {
      setChanging(false); // nothing to send, nothing to say
      return;
    }
    savingStatus.current = true;
    setStatusBusy(true);
    try {
      // The server's row is in every cache when this resolves (storeApplication): no skeleton, no refetch.
      await changeStatus(a.id, next, a.status);
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setChanging(false); // the not-found view takes over
      else toast.error(errorMessage(e) ?? "Couldn't change the status. Try again."); // the dialog stays open
      return;
    } finally {
      savingStatus.current = false;
      setStatusBusy(false);
    }
    setChanging(false);
    focusAfterStatus.current = true;
    toast.success("Status updated.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="rounded-sm border border-border-subtle bg-surface-card p-4">
        <h2 className="text-section-title text-text-primary [overflow-wrap:anywhere]">{a.job_name}</h2>
        <p className="mt-1 text-body text-text-secondary [overflow-wrap:anywhere]">{a.company}</p>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border-subtle pt-3">
          <StatusStamp value={a.status} />
          <Button ref={statusBtn} variant="secondary" onClick={() => setChanging(true)} disabled={state.refreshing}>
            Change status
          </Button>
        </div>
      </div>
      <section aria-labelledby="d-details">
        <h3 id="d-details" className={heading}>
          Details
        </h3>
        <DetailRows application={a} />
      </section>
      {a.remarks && (
        <section aria-labelledby="d-notes">
          <h3 id="d-notes" className={heading}>
            Notes
          </h3>
          <p className="whitespace-pre-line rounded-sm border border-border-subtle bg-surface-card p-4 text-body text-text-primary [overflow-wrap:anywhere]">
            {a.remarks}
          </p>
        </section>
      )}
      <section aria-labelledby="d-interviews">
        <div className="mb-2 flex min-h-11 items-center justify-between gap-3">
          <h3 ref={ivHeading} id="d-interviews" tabIndex={-1} className="text-section-title text-text-secondary outline-none">
            Interviews
          </h3>
          {/* Loading, failed or non-empty: the create route does not need the list. Empty has its own button. */}
          {!(iv.kind === "ready" && iv.items.length === 0) && (
            <Button variant="secondary" href={addHref}>
              Add interview
            </Button>
          )}
        </div>
        {iv.kind === "loading" ? (
          <p className="text-caption text-text-muted">Loading interviews…</p>
        ) : iv.kind === "error" ? (
          <LoadError title="Couldn't load interviews." onRetry={iv.retry} />
        ) : iv.items.length === 0 ? (
          <div className="flex flex-col items-start gap-3">
            <p className="text-caption text-text-muted">No interviews yet.</p>
            <Button ref={emptyAdd} variant="secondary" href={addHref}>
              Add interview
            </Button>
          </div>
        ) : (
          <>
            <LedgerSheet label="Interviews">
              {sortInterviewsByDate(iv.items).map((i) => (
                <InterviewRow
                  key={i.id}
                  interview={i}
                  actions={
                    <>
                      <TextAction
                        href={`/applications/${a.id}/interviews/${i.id}/edit${qs}`}
                        disabled={state.refreshing}
                        aria-label={`Edit interview, ${when(i)}`}
                      >
                        Edit
                      </TextAction>
                      <TextAction
                        tone="danger"
                        onClick={() => setDeleting(i)}
                        disabled={state.refreshing}
                        aria-label={`Delete interview, ${when(i)}`}
                      >
                        Delete
                      </TextAction>
                    </>
                  }
                />
              ))}
            </LedgerSheet>
            {iv.total > iv.items.length && (
              <p className="mt-2 text-caption text-text-muted">
                Showing the first {iv.items.length} of {iv.total} interviews.
              </p>
            )}
          </>
        )}
      </section>
      <StatusDialog
        open={changing}
        current={a.status}
        busy={statusBusy}
        onCancel={() => setChanging(false)}
        onConfirm={confirmStatus}
      />
      <DeleteConfirm
        open={deleting !== null && !state.refreshing}
        busy={busy}
        onCancel={() => setDeleting(null)}
        onConfirm={confirmDelete}
        title="Delete this interview?"
        message={deleting ? interviewDeleteMessage(deleting, when(deleting)) : ""}
        confirmLabel="Delete interview"
      />
    </div>
  );
}
