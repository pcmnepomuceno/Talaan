"use client";

import { useCallback, useEffect, useState } from "react";
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
  | { kind: "error"; retry: () => void }
  | { kind: "ready"; application: Application; refreshing: boolean; interviews: InterviewsState };

type AppRes = { a: Application | null } | "error";
type IvRes = Page<Interview> | "gone" | "error";

export function useApplicationDetail(id: string | undefined) {
  const [appRes, setAppRes] = useState<AppRes | null>(null);
  const [ivRes, setIvRes] = useState<IvRes | null>(null);
  const [appTry, setAppTry] = useState(0);
  const [ivTry, setIvTry] = useState(0);

  // New id (or none): drop the results of the previous one during render, so old content can never
  // show for a moment under a different id.
  const [seen, setSeen] = useState(id);
  if (seen !== id) {
    setSeen(id);
    setAppRes(null);
    setIvRes(null);
  }

  const n = id === undefined ? null : parseId(id);

  // A response whose request started before a clearCaches() (a write, login, logout) is stale: it
  // is neither applied nor cached. `live` alone misses one that lands before React re-renders.
  useEffect(() => {
    if (n === null) return;
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
  }, [n, appTry]);

  useEffect(() => {
    if (n === null) return;
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
  }, [n, ivTry]);

  // Cache only a fully fresh detail (both requests landed).
  useEffect(() => {
    if (n === null || !appRes || appRes === "error" || !appRes.a) return;
    if (ivRes === null || ivRes === "gone") return;
    setDetail(n, { application: appRes.a, interviews: ivRes === "error" ? null : ivRes });
  }, [n, appRes, ivRes]);

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
        retryApp();
        retryInterviews();
      }),
    [retryApp, retryInterviews],
  );
  /** After a delete: back to this id must refetch, never show the deleted content. */
  const reset = useCallback(() => {
    setAppRes(null);
    setIvRes(null);
  }, []);

  let state: DetailState;
  if (id === undefined) state = { kind: "loading" };
  else if (n === null) state = { kind: "missing" };
  else if (appRes === "error") state = { kind: "error", retry: retryApp };
  else if (ivRes === "gone" || (appRes && appRes.a === null)) state = { kind: "missing" };
  else {
    const cached = getDetail(n);
    const fresh = appRes?.a ?? null;
    const application = fresh ?? cached?.application ?? null;
    if (!application) state = { kind: "loading" };
    else {
      const page = ivRes === null ? (cached?.interviews ?? null) : ivRes === "error" ? null : ivRes; // "gone" was handled above
      const interviews: InterviewsState =
        ivRes === "error"
          ? { kind: "error", retry: retryInterviews }
          : page
            ? { kind: "ready", items: page.items, total: page.total }
            : { kind: "loading" };
      state = { kind: "ready", application, refreshing: fresh === null, interviews };
    }
  }
  return { state, reset };
}
