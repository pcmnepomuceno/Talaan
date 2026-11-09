"use client";

import { useEffect, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { InterviewForm } from "@/components/interview-form";
import { LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { NotFoundState } from "@/components/not-found-state";
import { getApplication } from "@/lib/api";
import { getDetail } from "@/lib/cache";

type Load = "loading" | "missing" | "error" | "ready";

// The application must exist (and be the caller's) before the form shows, so nobody types a whole
// interview only to get "not found" on save. A cached detail counts (login, logout, account deletion
// and every write clear the caches); otherwise it is fetched. The POST 404 stays as the fallback for
// an application deleted in another tab. A 401 goes to /login?expired=1&next=<this path>.
export function NewInterviewScreen({ id, qs }: { id: number; qs: string }) {
  const [load, setLoad] = useState<{ id: number; tries: number; result: Load } | null>(null);
  const [tries, setTries] = useState(0);
  // Read once: a successful save clears the caches, and re-reading on the next render would swap the
  // form for a skeleton and refetch. The page keys this screen by id, so a new id starts over.
  const [cached] = useState(() => getDetail(id) !== undefined);
  // Empty live region first, text after mount: a region added together with its text is often not announced.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true));
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (cached) return;
    let live = true;
    getApplication(id).then(
      (a) => live && setLoad({ id, tries, result: a ? "ready" : "missing" }),
      () => live && setLoad({ id, tries, result: "error" }),
    );
    return () => {
      live = false;
    };
  }, [id, tries, cached]);

  const result: Load = cached ? "ready" : load?.id === id && load.tries === tries ? load.result : "loading";
  if (result === "ready") return <InterviewForm applicationId={id} qs={qs} />;

  return (
    <>
      <div role="status" className="sr-only">
        {mounted && result === "loading" ? "Loading application" : ""}
      </div>
      <AppBar title="Add interview" backHref={`/applications/${id}${qs}`} />
      <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
        {result === "loading" && <LedgerSkeleton rows={2} silent />}
        {result === "missing" && <NotFoundState qs={qs} />}
        {result === "error" && <LoadError title="Couldn't load this application." onRetry={() => setTries((t) => t + 1)} />}
      </main>
    </>
  );
}
