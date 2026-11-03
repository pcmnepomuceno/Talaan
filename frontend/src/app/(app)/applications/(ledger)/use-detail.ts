"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { getApplication, getInterviews, parseId } from "@/lib/api";
import { cacheVersion, dropDetail, getDetail, onCachesCleared, setDetail } from "@/lib/cache";
import { ApiError } from "@/lib/http";
import type { Page } from "@/lib/mappers";
import type { Application, Interview } from "@/lib/types";

// The application and its interviews are two requests that fail separately: a failed interviews
// fetch shows an inline error with Retry and never hides the application. A cached detail (a
// revisit with no write in between) shows at once with `refreshing: true`, so the screen can
// disable Edit and Delete until fresh data lands (stale-while-revalidate).
export type InterviewsState =
  | { kind: "loading" }
  | { kind: "error"; retry: () => void }
  | { kind: "ready"; items: Interview[]; total: number };

export type DetailState =
  | { kind: "loading" }
  | { kind: "missing" }
  | { kind: "removed" } // deleted here: render nothing until the route changes
  | { kind: "error"; retry: () => void }
  | { kind: "ready"; application: Application; refreshing: boolean; interviews: InterviewsState };

// Kept data (F6): the one exception to "a clear means skeleton, then fresh data". An interview deleted
// in place keeps the page on screen, minus that row, while the refetch runs. It lives in this hook's
// state only: dropped on an id change and on unmount, so a form route (a remount) never shows pre-edit data.
type Kept = { id: number; application: Application; interviews: { items: Interview[]; total: number } };

type AppRes = { a: Application | null } | "error";
type IvRes = Page<Interview> | "gone" | "error";

export function useApplicationDetail(id: string | undefined) {
  const [appRes, setAppRes] = useState<AppRes | null>(null);
  const [ivRes, setIvRes] = useState<IvRes | null>(null);
  const [appTry, setAppTry] = useState(0);
  const [ivTry, setIvTry] = useState(0);
  // A delete from this screen: `removing` (a ref, read synchronously by the clearCaches listener)
  // is set before the request, so the clear it triggers does not refetch; `removed` is set on
  // success, so this id is never fetched or rendered again ("Application not found." included).
  const removing = useRef(false);
  const [removed, setRemoved] = useState<number | null>(null);
  const [kept, setKept] = useState<Kept | null>(null);
  // holding: a kept copy exists; sawClear: the delete's cache clear has happened (results were nulled).
  const holding = useRef(false);
  const sawClear = useRef(false);
  const latest = useRef<DetailState>({ kind: "loading" }); // what is on screen now, for holdForInterviewDelete

  // New id (or none): drop the results of the previous one during render, so old content can never
  // show for a moment under a different id.
  const [seen, setSeen] = useState(id);
  if (seen !== id) {
    setSeen(id);
    setAppRes(null);
    setIvRes(null);
    setRemoved(null); // Back to a deleted id is a fresh visit: fetch it (and show not-found)
    setKept(null);
  }

  const n = id === undefined ? null : parseId(id);

  // A response whose request started before a clearCaches() (a write, login, logout) is stale: it
  // is neither applied nor cached. `live` alone misses one that lands before React re-renders.
  useEffect(() => {
    removing.current = false;
    holding.current = sawClear.current = false;
  }, [n]);

  useEffect(() => {
    if (n === null || n === removed) return;
    let live = true;
    const v = cacheVersion();
    const current = () => live && cacheVersion() === v;
    getApplication(n).then(
      (a) => {
        if (a === null) dropDetail(n); // gone (or never ours): a revisit must not show the old record
        if (current()) setAppRes({ a });
      },
      () => current() && setAppRes("error"),
    );
    return () => {
      live = false;
    };
  }, [n, appTry, removed]);

  useEffect(() => {
    if (n === null || n === removed) return;
    let live = true;
    const v = cacheVersion();
    const current = () => live && cacheVersion() === v;
    getInterviews(n).then(
      (p) => current() && setIvRes(p),
      (e) => {
        const gone = e instanceof ApiError && e.status === 404;
        if (gone) dropDetail(n);
        if (current()) setIvRes(gone ? "gone" : "error");
      },
    );
    return () => {
      live = false;
    };
  }, [n, ivTry, removed]);

  // Cache only a fully fresh detail (both requests landed).
  useEffect(() => {
    if (n === null || !appRes || appRes === "error" || !appRes.a) return;
    if (ivRes === null || ivRes === "gone") return;
    setDetail(n, { application: appRes.a, interviews: ivRes === "error" ? null : ivRes });
  }, [n, appRes, ivRes]);

  // After the delete's clear, once both refetches have answered (any way) the kept copy has done its job.
  useEffect(() => {
    if (kept && sawClear.current && appRes !== null && ivRes !== null) {
      holding.current = sawClear.current = false;
      setKept(null);
    }
  }, [kept, appRes, ivRes]);

  const retryApp = useCallback(() => {
    setAppRes(null);
    setAppTry((t) => t + 1);
  }, []);
  const retryInterviews = useCallback(() => {
    setIvRes(null);
    setIvTry((t) => t + 1);
  }, []);
  // A clear drops both results (so the cache-store effect never pairs an old one with a new one)
  // and refetches: the user sees the skeleton, then fresh data.
  useEffect(
    () =>
      onCachesCleared(() => {
        if (removing.current) return; // our own delete: this id must not be fetched again
        if (holding.current) sawClear.current = true;
        retryApp();
        retryInterviews();
      }),
    [retryApp, retryInterviews],
  );
  /** Call before the DELETE request, with false again if it fails. */
  const setRemoving = useCallback((on: boolean) => {
    removing.current = on;
  }, []);
  /** After a successful DELETE of `id`: never fetch or show it again on this visit. */
  const markRemoved = useCallback((id: number) => {
    setRemoved(id);
    setAppRes(null);
    setIvRes(null);
  }, []);

  /** Call before the DELETE request: keeps what is on screen so the clear it triggers does not blank the page. */
  const holdForInterviewDelete = useCallback(() => {
    const s = latest.current;
    if (s.kind === "ready" && s.interviews.kind === "ready" && n !== null) {
      holding.current = true;
      sawClear.current = false;
      setKept({ id: n, application: s.application, interviews: { items: s.interviews.items, total: s.interviews.total } });
    }
  }, [n]);
  /** After a confirmed delete (204 or 404): the row goes at once; the background refetch brings the rest. */
  const dropInterview = useCallback((interviewId: number) => {
    setKept((k) =>
      k && {
        ...k,
        interviews: { items: k.interviews.items.filter((i) => i.id !== interviewId), total: Math.max(0, k.interviews.total - 1) },
      },
    );
  }, []);
  /** The DELETE failed: nothing was removed, so forget the held copy. */
  const releaseHold = useCallback(() => {
    holding.current = sawClear.current = false;
    setKept(null);
  }, []);

  let state: DetailState;
  if (id === undefined) state = { kind: "loading" };
  else if (n === null) state = { kind: "missing" };
  else if (n === removed) state = { kind: "removed" };
  else if (appRes === "error") state = { kind: "error", retry: retryApp };
  else if (ivRes === "gone" || (appRes && appRes.a === null)) state = { kind: "missing" };
  else {
    const cached = getDetail(n);
    const hold = kept?.id === n ? kept : null;
    const fresh = appRes?.a ?? null;
    const application = fresh ?? cached?.application ?? hold?.application ?? null;
    if (!application) state = { kind: "loading" };
    else {
      const page = ivRes === null ? (hold?.interviews ?? cached?.interviews ?? null) : ivRes === "error" ? null : ivRes; // "gone" was handled above
      const interviews: InterviewsState =
        ivRes === "error"
          ? { kind: "error", retry: retryInterviews }
          : page
            ? { kind: "ready", items: page.items, total: page.total }
            : { kind: "loading" };
      state = { kind: "ready", application, refreshing: fresh === null, interviews };
    }
  }
  useEffect(() => {
    latest.current = state;
  });
  return { state, setRemoving, markRemoved, holdForInterviewDelete, dropInterview, releaseHold };
}
