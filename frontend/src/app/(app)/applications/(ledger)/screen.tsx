"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { AppBar, BarAction } from "@/components/app-bar";
import { Button } from "@/components/button";
import { DeleteConfirm } from "@/components/dialog";
import { EmptyState } from "@/components/empty-state";
import { FilterTabs, type Filter } from "@/components/filter-tabs";
import { Icon } from "@/components/icon";
import { LoadError } from "@/components/load-error";
import { ApplicationRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { useToast } from "@/components/toast";
import { ApiError } from "@/lib/http";
import { deleteApplication, getApplication, getInterviews, parseId, parseStatus } from "@/lib/api";
import type { Application, Interview } from "@/lib/types";
import { useApplicationList } from "./use-list";

// Below 1280 the list and the detail are separate screens (one is hidden); from 1280 both show.
// Exported so the routing rule is testable without CSS.
export function panes(hasDetail: boolean) {
  return {
    list: hasDetail ? "hidden xl:block" : "",
    detail: hasDetail ? "" : "hidden xl:block",
  };
}

export type DetailState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "error"; retry: () => void }
  | { kind: "ready"; application: Application; interviews: Interview[] };

const DetailContext = createContext<DetailState>({ kind: "loading" });
export const useDetail = () => useContext(DetailContext);

// Interviews of a missing application answer 404; getApplication already reports that as null.
const emptyIf404 = (e: unknown) => {
  if (e instanceof ApiError && e.status === 404) return { items: [], total: 0 };
  throw e;
};
type DetailData = { id: string; state: DetailState };

export function ApplicationsScreen({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const id = useParams<{ id?: string }>().id;
  const status = parseStatus(useSearchParams().get("status"));
  const qs = status ? `?status=${status}` : "";

  const [detail, setDetail] = useState<DetailData | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [detailTry, setDetailTry] = useState(0);

  const { view, retry, loadMore, announcement, focusId, clearFocus } = useApplicationList(status);
  const listRef = useRef<HTMLDivElement>(null);

  // After "Load more" the button may disappear (end of list): focus the first new row instead.
  useEffect(() => {
    if (focusId === null) return;
    listRef.current?.querySelector<HTMLElement>(`a[href="/applications/${focusId}${qs}"]`)?.focus();
    clearFocus();
  }, [focusId, qs, clearFocus]);

  useEffect(() => {
    if (id === undefined) return;
    let live = true;
    (async () => {
      let state: DetailState;
      try {
        const n = parseId(id);
        // Independent requests: one round trip, not two. A null application means not found.
        const [application, interviews] =
          n === null ? [null, { items: [], total: 0 }] : await Promise.all([getApplication(n), getInterviews(n).catch(emptyIf404)]);
        state = application ? { kind: "ready", application, interviews: interviews.items } : { kind: "missing" };
      } catch {
        state = {
          kind: "error",
          retry: () => {
            setDetail(null);
            setDetailTry((t) => t + 1);
          },
        };
      }
      if (live) setDetail({ id, state });
    })();
    return () => {
      live = false;
    };
  }, [id, detailTry]);

  const hasDetail = id !== undefined;
  const state: DetailState = hasDetail && detail?.id === id ? detail.state : { kind: "loading" };
  const ready = state.kind === "ready" ? state.application : null;
  const cls = panes(hasDetail);

  const base = hasDetail ? `/applications/${id}` : "/applications";
  const onFilter = (f: Filter) => router.replace(f === "all" ? base : `${base}?status=${f}`);

  async function confirmDelete() {
    if (!ready) return;
    setBusy(true);
    try {
      await deleteApplication(ready.id);
    } catch {
      // Dialog stays open and dismissable (busy is cleared below) so the user can retry or cancel.
      toast.error("Couldn't delete the application. Try again.");
      return;
    } finally {
      setBusy(false);
    }
    setDetail(null); // Back to the deleted id must refetch (loading, then not found), never show old content.
    setConfirming(false);
    toast.success("Application deleted.");
    router.push(`/applications${qs}`);
  }

  const editHref = `/applications/${id}/edit${qs}`;
  const actions = ready && (
    <>
      <BarAction href={editHref}>Edit</BarAction>
      <BarAction onClick={() => setConfirming(true)}>Delete</BarAction>
    </>
  );

  return (
    <>
      {hasDetail ? (
        <AppBar title="Application detail" backHref={`/applications${qs}`} actions={actions} />
      ) : (
        <AppBar />
      )}
      {/* Always mounted, so changes are announced (a region added together with its text often is not). */}
      <div role="status" className="sr-only">
        {view.kind === "loading" ? "Loading applications" : hasDetail && state.kind === "loading" ? "Loading application" : announcement}
      </div>
      <main
        id="content"
        tabIndex={-1}
        className="mx-auto max-w-[640px] outline-none xl:grid xl:max-w-[1120px] xl:grid-cols-[400px_minmax(0,720px)]"
      >
        <section
          aria-label="Applications"
          className={`px-4 pt-4 pb-[calc(10rem+env(safe-area-inset-bottom))] md:pb-24 xl:sticky xl:top-0 xl:h-dvh xl:overflow-y-auto xl:px-6 xl:pt-8 xl:pb-8 ${cls.list}`}
        >
          <h1 className="sr-only xl:hidden">Applications</h1>
          <div className="mb-4 hidden items-center justify-between gap-3 xl:flex">
            <h1 className="text-section-title text-text-primary">Applications</h1>
            <Button href={`/applications/new${qs}`}>Add application</Button>
          </div>
          <FilterTabs value={status ?? "all"} onChange={onFilter} />
          <div className="mt-3" ref={listRef}>
            {view.kind === "loading" ? (
              <LedgerSkeleton silent />
            ) : view.kind === "failed" ? (
              <LoadError title="Couldn't load applications." onRetry={retry} />
            ) : view.total === 0 ? (
              status === undefined ? (
                <EmptyState
                  title="No applications yet."
                  message="Add the first job you applied to."
                  action={<Button href={`/applications/new${qs}`}>Add application</Button>}
                />
              ) : (
                <EmptyState
                  title="No applications with this status."
                  message="Choose another status or show all applications."
                  action={
                    <Button variant="secondary" href={base}>
                      Show all
                    </Button>
                  }
                />
              )
            ) : (
              <>
                {view.refreshFailed && (
                  <div className="mb-3">
                    <LoadError title="Couldn't refresh the list. Showing the last loaded rows." onRetry={retry} />
                  </div>
                )}
                <LedgerSheet label="Applications">
                  {view.items.map((a) => (
                    <ApplicationRow
                      key={a.id}
                      application={a}
                      href={`/applications/${a.id}${qs}`}
                      selected={String(a.id) === id}
                    />
                  ))}
                </LedgerSheet>
                {view.items.length < view.total && (
                  <div className="mt-3 flex flex-col items-center gap-3">
                    {view.more === "failed" ? (
                      <LoadError title="Couldn't load more applications." onRetry={loadMore} />
                    ) : (
                      <Button
                        variant="secondary"
                        onClick={loadMore}
                        disabled={view.more === "loading" || view.refreshing}
                        aria-busy={view.more === "loading" || undefined}
                      >
                        {view.more === "loading" ? "Loading…" : "Load more"}
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
        <section
          aria-label="Application detail"
          className={`px-4 pt-4 pb-28 md:pb-8 xl:border-l xl:border-border-subtle xl:px-6 xl:pt-8 xl:pb-8 ${cls.detail}`}
        >
          {hasDetail && (
            <div className="mb-4 hidden min-h-11 items-center justify-between gap-3 xl:flex">
              <h2 className="text-body text-text-secondary">Application detail</h2>
              <div className="flex items-center text-primary">
                {ready && (
                  <>
                    <Link href={editHref} className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 text-body-medium">
                      Edit
                    </Link>
                    <button
                      type="button"
                      onClick={() => setConfirming(true)}
                      className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-sm px-2 text-body-medium text-error-text"
                    >
                      Delete
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
          <DetailContext value={state}>{children}</DetailContext>
        </section>
      </main>
      {!hasDetail && (
        <Link
          href={`/applications/new${qs}`}
          aria-label="Add application"
          className="fixed right-4 bottom-[calc(5rem+env(safe-area-inset-bottom))] z-20 flex size-14 items-center justify-center rounded-fab bg-primary text-text-inverse shadow-float md:bottom-[calc(1rem+env(safe-area-inset-bottom))] xl:hidden"
        >
          <Icon name="add" />
        </Link>
      )}
      <DeleteConfirm
        open={confirming && ready !== null}
        busy={busy}
        onCancel={() => setConfirming(false)}
        onConfirm={confirmDelete}
        title="Delete this application?"
        message={ready ? `${ready.company}, ${ready.job_name}, and its interviews will be removed. This cannot be undone.` : ""}
        confirmLabel="Delete application"
      />
    </>
  );
}
