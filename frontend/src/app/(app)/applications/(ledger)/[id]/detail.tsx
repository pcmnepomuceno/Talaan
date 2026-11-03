"use client";

import { LoadError } from "@/components/load-error";
import { DetailRows, InterviewRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { NotFoundState } from "@/components/not-found-state";
import { StatusStamp } from "@/components/status-stamp";
import { sortInterviewsByDate } from "@/lib/interviews";
import { useDetail } from "../screen";

const heading = "mb-2 text-section-title text-text-secondary";

export function ApplicationDetail() {
  const state = useDetail();
  // The screen's persistent live region announces "Loading application"; the skeleton is visual only.
  if (state.kind === "loading") return <LedgerSkeleton rows={2} silent />;
  if (state.kind === "error") return <LoadError title="Couldn't load this application." onRetry={state.retry} />;
  if (state.kind === "missing") return <NotFoundState />;
  const { application: a, interviews: iv } = state;
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
        <h3 id="d-interviews" className={heading}>
          Interviews
        </h3>
        {iv.kind === "loading" ? (
          <p className="text-caption text-text-muted">Loading interviews…</p>
        ) : iv.kind === "error" ? (
          <LoadError title="Couldn't load interviews." onRetry={iv.retry} />
        ) : iv.items.length === 0 ? (
          <p className="text-caption text-text-muted">No interviews yet.</p>
        ) : (
          <>
            <LedgerSheet label="Interviews">
              {sortInterviewsByDate(iv.items).map((i) => (
                <InterviewRow key={i.id} interview={i} />
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
    </div>
  );
}
