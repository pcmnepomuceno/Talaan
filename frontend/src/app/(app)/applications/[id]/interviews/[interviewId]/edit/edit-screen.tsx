"use client";

import { useEffect, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { InterviewForm } from "@/components/interview-form";
import { LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { NotFoundState } from "@/components/not-found-state";
import { getInterview, parseId } from "@/lib/api";
import type { Interview } from "@/lib/types";

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; interview: Interview };

// Always fetches the record fresh (never the cache): a form must start from the server's data.
// An interview that belongs to another application than the route says counts as not found.
// A 401 goes to /login?expired=1&next=<this path>, and after login this runs again.
export function EditInterviewScreen({ id, interviewId, qs }: { id: string; interviewId: string; qs: string }) {
  const appId = parseId(id);
  const n = parseId(interviewId);
  const [load, setLoad] = useState<{ appId: number; n: number; tries: number; result: Load } | null>(null);
  const [tries, setTries] = useState(0);
  // Empty live region first, text after mount: a region added together with its text is often not announced.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true));
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (n === null || appId === null) return;
    let live = true;
    getInterview(n).then(
      (interview) =>
        live &&
        setLoad({
          appId,
          n,
          tries,
          result: interview && interview.job_application_id === appId ? { kind: "ready", interview } : { kind: "missing" },
        }),
      () => live && setLoad({ appId, n, tries, result: { kind: "error" } }),
    );
    return () => {
      live = false;
    };
  }, [n, appId, tries]);

  const backHref = `/applications/${id}${qs}`;
  // Keyed by both ids: a result for the same interview under another application (only [id] changed) is not reused.
  const fresh = load?.appId === appId && load.n === n && load.tries === tries;
  const result: Load = n === null || appId === null ? { kind: "missing" } : fresh ? load.result : { kind: "loading" };

  return (
    <>
      <div role="status" className="sr-only">
        {mounted && result.kind === "loading" ? "Loading interview" : ""}
      </div>
      {result.kind === "ready" && appId !== null ? (
        <InterviewForm applicationId={appId} interview={result.interview} qs={qs} />
      ) : (
        <>
          <AppBar title="Edit interview" backHref={backHref} />
          <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
            {result.kind === "loading" && <LedgerSkeleton rows={2} silent />}
            {result.kind === "missing" && (
              <NotFoundState title="Interview not found." message="It may have been deleted." href={backHref} linkLabel="Back to application" />
            )}
            {result.kind === "error" && <LoadError title="Couldn't load this interview." onRetry={() => setTries((t) => t + 1)} />}
          </main>
        </>
      )}
    </>
  );
}
