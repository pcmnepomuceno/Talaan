"use client";

import { useEffect, useState } from "react";
import { AppBar } from "@/components/app-bar";
import { ApplicationForm } from "@/components/application-form";
import { LedgerSkeleton } from "@/components/ledger";
import { LoadError } from "@/components/load-error";
import { NotFoundState } from "@/components/not-found-state";
import { getApplication, parseId } from "@/lib/api";
import type { Application } from "@/lib/types";

type Load = { kind: "loading" } | { kind: "missing" } | { kind: "error" } | { kind: "ready"; application: Application };

// Always fetches the record fresh (never the cache): a form must start from the server's data.
// A 401 here goes to /login?expired=1&next=/applications/<id>/edit..., and after login this runs again.
export function EditScreen({ id, qs }: { id: string; qs: string }) {
  const n = parseId(id);
  const [load, setLoad] = useState<{ n: number | null; tries: number; result: Load } | null>(null);
  const [tries, setTries] = useState(0);
  // The live region renders empty first and gets its text after mount: a region added together
  // with its text is often not announced. It stays mounted through loading, error, retry and form.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setMounted(true)); // next task: the empty region is in the page first
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (n === null) return;
    let live = true;
    getApplication(n).then(
      (application) => live && setLoad({ n, tries, result: application ? { kind: "ready", application } : { kind: "missing" } }),
      () => live && setLoad({ n, tries, result: { kind: "error" } }),
    );
    return () => {
      live = false;
    };
  }, [n, tries]);

  const result: Load = n === null ? { kind: "missing" } : load?.n === n && load.tries === tries ? load.result : { kind: "loading" };

  return (
    <>
      <div role="status" className="sr-only">
        {mounted && result.kind === "loading" ? "Loading application" : ""}
      </div>
      {result.kind === "ready" ? (
        <ApplicationForm application={result.application} qs={qs} />
      ) : (
        <>
          <AppBar title="Edit application" backHref={`/applications${qs}`} />
          <main id="content" tabIndex={-1} className="mx-auto max-w-[640px] px-4 pt-6 pb-24 outline-none md:pb-6">
            {result.kind === "loading" && <LedgerSkeleton rows={2} silent />}
            {result.kind === "missing" && <NotFoundState />}
            {result.kind === "error" && <LoadError title="Couldn't load this application." onRetry={() => setTries((t) => t + 1)} />}
          </main>
        </>
      )}
    </>
  );
}
