"use client";

import { Button } from "@/components/button";
import { LoadError } from "@/components/load-error";
import { DetailRows, InterviewRow, LedgerSheet } from "@/components/ledger";
import { StatusStamp } from "@/components/status-stamp";
import { sortInterviewsByDate } from "@/lib/interviews";
import { useDetail } from "../screen";

const heading = "mb-2 text-section-title text-text-secondary";

export function ApplicationDetail() {
  const state = useDetail();
  if (state.kind === "loading") {
    return (
      <div role="status" className="py-12 text-center text-caption text-text-muted">
        Loading application
      </div>
    );
  }
  if (state.kind === "error") return <LoadError title="Couldn't load this application." onRetry={state.retry} />;
  if (state.kind === "missing") {
    return (
      <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
        <h2 className="text-section-title text-text-primary">Application not found.</h2>
        <p className="text-caption text-text-muted">It may have been deleted.</p>
        <Button variant="secondary" href="/applications">
          Back to applications
        </Button>
      </div>
    );
  }
  const { application: a, interviews } = state;
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
        {interviews.length === 0 ? (
          <p className="text-caption text-text-muted">No interviews yet.</p>
        ) : (
          <LedgerSheet label="Interviews">
            {sortInterviewsByDate(interviews).map((i) => (
              <InterviewRow key={i.id} interview={i} />
            ))}
          </LedgerSheet>
        )}
      </section>
    </div>
  );
}
