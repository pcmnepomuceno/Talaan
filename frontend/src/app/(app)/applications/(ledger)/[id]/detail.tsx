"use client";

import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Button, TextAction } from "@/components/button";
import { DeleteConfirm } from "@/components/dialog";
import { useToast } from "@/components/toast";
import { LoadError } from "@/components/load-error";
import { DetailRows, InterviewRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { NotFoundState } from "@/components/not-found-state";
import { deleteInterview, parseStatus } from "@/lib/api";
import { formatDateTimePHT } from "@/lib/format";
import type { Interview } from "@/lib/types";
import { StatusStamp } from "@/components/status-stamp";
import { interviewDeleteMessage, sortInterviewsByDate } from "@/lib/interviews";
import { useDetail } from "../screen";

const heading = "mb-2 text-section-title text-text-secondary";

export function ApplicationDetail() {
  const { state, holdForInterviewDelete, dropInterview, releaseHold } = useDetail();
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
    holdForInterviewDelete(); // the cache clear inside deleteInterview must not blank the page
    try {
      await deleteInterview(target.id); // 404 resolves too: already gone is what we wanted
    } catch {
      releaseHold();
      toast.error("Couldn't delete the interview. Try again."); // the dialog stays open
      return;
    } finally {
      setBusy(false);
    }
    dropInterview(target.id);
    setDeleting(null);
    focusAfterDelete.current = true; // read by the effect after this render
    toast.success("Interview deleted.");
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-start justify-between gap-3 rounded-sm border border-border-subtle bg-surface-card p-4">
        <div className="min-w-0">
          <h2 className="text-section-title text-text-primary [overflow-wrap:anywhere]">{a.job_name}</h2>
          <p className="mt-1 text-body text-text-secondary [overflow-wrap:anywhere]">{a.company}</p>
        </div>
        <StatusStamp value={a.status} />
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
          {iv.kind === "ready" && iv.items.length > 0 && (
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
