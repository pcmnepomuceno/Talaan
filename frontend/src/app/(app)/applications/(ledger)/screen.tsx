"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { AppBar, BarAction } from "@/components/app-bar";
import { Button, TextAction } from "@/components/button";
import { DeleteConfirm } from "@/components/dialog";
import { EmptyState } from "@/components/empty-state";
import { Icon } from "@/components/icon";
import { LoadError } from "@/components/load-error";
import { type Filter, StatusFilter } from "@/components/status-filter";
import { ApplicationRow, LedgerSheet, LedgerSkeleton } from "@/components/ledger";
import { useToast } from "@/components/toast";
import { WakingUp } from "@/components/waking-up";
import { deleteApplication, parseStatus } from "@/lib/api";
import { loadedOnce } from "@/lib/cache";
import { type DetailState, useApplicationDetail } from "./use-detail";
import { useApplicationList } from "./use-list";

// Below 1280 the list and the detail are separate screens (one is hidden); from 1280 both show.
// Exported so the routing rule is testable without CSS.
export function panes(hasDetail: boolean) {
  return {
    list: hasDetail ? "hidden xl:block" : "",
    detail: hasDetail ? "" : "hidden xl:block",
  };
}

const DetailContext = createContext<DetailState>({ kind: "loading" });
export const useDetail = () => useContext(DetailContext);

export function ApplicationsScreen({ children }: { children: ReactNode }) {
  const router = useRouter();
  const toast = useToast();
  const id = useParams<{ id?: string }>().id;
  const status = parseStatus(useSearchParams().get("status"));
  const qs = status ? `?status=${status}` : "";

  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const { view, retry, loadMore, announcement, clearAnnouncement, focusId, clearFocus } = useApplicationList(status);
  const listRef = useRef<HTMLDivElement>(null);

  // After "Load more" the button may disappear (end of list): focus the first new row instead.
  useEffect(() => {
    if (focusId === null) return;
    listRef.current?.querySelector<HTMLElement>(`a[href="/applications/${focusId}${qs}"]`)?.focus();
    clearFocus();
  }, [focusId, qs, clearFocus]);

  const hasDetail = id !== undefined;
  const { state, setRemoving, markRemoved } = useApplicationDetail(id);
  // Opening another detail makes "N more applications loaded" old news: never fall back to it.
  useEffect(() => clearAnnouncement(), [id, clearAnnouncement]);
  const ready = state.kind === "ready" ? state.application : null;
  const refreshing = state.kind === "ready" && state.refreshing;
  const detailBusy = state.kind === "loading" || (state.kind === "ready" && (state.refreshing || state.interviews.kind === "loading"));
  const cls = panes(hasDetail);
  // Only while there is nothing to show yet: never for a reload after a cache clear.
  const wakePending = (view.kind === "loading" || (hasDetail && state.kind === "loading")) && !loadedOnce();

  const base = hasDetail ? `/applications/${id}` : "/applications";
  const onFilter = (f: Filter) => router.replace(f === "all" ? base : `${base}?status=${f}`);

  async function confirmDelete() {
    if (!ready) return;
    setBusy(true);
    setRemoving(true); // the cache clear inside deleteApplication must not refetch this id
    try {
      await deleteApplication(ready.id);
    } catch {
      setRemoving(false);
      // Dialog stays open and dismissable (busy is cleared below) so the user can retry or cancel.
      toast.error("Couldn't delete the application. Try again.");
      return;
    } finally {
      setBusy(false);
    }
    // In the same tick as the clear: the open detail (two panes from 1280) never fetches or shows the
    // deleted id again, so no "Application not found." flash. Back to it later is a fresh visit.
    markRemoved(ready.id);
    setConfirming(false);
    toast.success("Application deleted.");
    // replace, not push: Back would otherwise land on the id that no longer exists.
    router.replace(`/applications${qs}`);
  }

  const editHref = `/applications/${id}/edit${qs}`;
  const actions = ready && (
    <>
      <BarAction href={editHref} disabled={refreshing}>
        Edit
      </BarAction>
      <BarAction onClick={() => setConfirming(true)} disabled={refreshing}>
        Delete
      </BarAction>
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
        {hasDetail && state.kind === "loading" ? "Loading application" : view.kind === "loading" ? "Loading applications" : announcement}
      </div>
      {/* Below 1280: one line above the screen while the first list or detail load is slow (DESIGN.md 6.12). */}
      <div className="mx-auto max-w-[640px] px-4 xl:hidden">
        <WakingUp pending={wakePending} />
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
          {/* From 1280 the same line sits inside the h-dvh list pane, so it never makes the page scroll.
              Only one of the two copies is displayed (and so announced) at any width. */}
          <div className="hidden xl:block">
            <WakingUp pending={wakePending} />
          </div>
          <StatusFilter value={status ?? "all"} onChange={onFilter} />
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
                {view.nextOffset < view.total && (
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
          aria-busy={detailBusy || undefined}
          className={`px-4 pt-4 pb-28 md:pb-8 xl:border-l xl:border-border-subtle xl:px-6 xl:pt-8 xl:pb-8 ${cls.detail}`}
        >
          {hasDetail && (
            <div className="mb-4 hidden min-h-11 items-center justify-between gap-3 xl:flex">
              <h2 className="text-body text-text-secondary">Application detail</h2>
              <div className="flex items-center">
                {ready && (
                  <>
                    <TextAction href={editHref} disabled={refreshing}>
                      Edit
                    </TextAction>
                    <TextAction tone="danger" onClick={() => setConfirming(true)} disabled={refreshing}>
                      Delete
                    </TextAction>
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
        open={confirming && ready !== null && !refreshing}
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
