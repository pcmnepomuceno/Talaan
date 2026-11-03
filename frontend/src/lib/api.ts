// Real applications client (F5). Screens import only these functions. Every request goes through
// request() in http.ts; every response goes through mappers.ts. The three writes clear the
// in-memory caches themselves (cache.ts), so no screen can forget to.
import { clearCaches } from "./cache";
import { ApiError, request } from "./http";
import {
  type ApplicationInput,
  fromApiApplication,
  fromApiInterview,
  fromApiPage,
  type Page,
  toCreateBody,
  toPatchBody,
} from "./mappers";
import { type Application, type Interview, STATUSES, type Status } from "./types";

export const PAGE_SIZE = 50;
export const INTERVIEWS_LIMIT = 100;
const BASE = "/api/v1/applications";

/** A route id is valid only in canonical form ("1", not "01" or "1e3") and as a safe integer. */
export function parseId(raw: string): number | null {
  const n = Number(raw);
  return Number.isSafeInteger(n) && String(n) === raw ? n : null;
}

/** Unknown or missing values mean "all". */
export const parseStatus = (raw: string | null | undefined): Status | undefined =>
  STATUSES.find((s) => s === raw);

/** One page, newest first. `total` counts every row matching the status filter, not just this page. */
export async function getApplications(status?: Status, offset = 0): Promise<Page<Application>> {
  const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (status) q.set("status", status);
  return fromApiPage(await request<unknown>(`${BASE}?${q}`), fromApiApplication);
}

/** null = not found (missing, or another user's: the API answers 404 for both). */
export async function getApplication(id: number): Promise<Application | null> {
  try {
    return fromApiApplication(await request<unknown>(`${BASE}/${id}`));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

/** Oldest first. Rejects with ApiError(404) when the application is gone. */
export async function getInterviews(applicationId: number): Promise<Page<Interview>> {
  return fromApiPage(
    await request<unknown>(`${BASE}/${applicationId}/interviews?limit=${INTERVIEWS_LIMIT}&offset=0`),
    fromApiInterview,
  );
}

export async function createApplication(input: ApplicationInput): Promise<Application> {
  const row = fromApiApplication(await request<unknown>(BASE, { method: "POST", body: toCreateBody(input) }));
  clearCaches();
  return row;
}

/** Sends only the fields that differ from `initial`. */
export async function updateApplication(id: number, initial: ApplicationInput, next: ApplicationInput): Promise<Application> {
  try {
    const row = fromApiApplication(await request<unknown>(`${BASE}/${id}`, { method: "PATCH", body: toPatchBody(initial, next) }));
    clearCaches();
    return row;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
}

/** 404 means it is already gone, which is what the caller wanted: resolves either way. */
export async function deleteApplication(id: number): Promise<void> {
  try {
    await request(`${BASE}/${id}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  clearCaches();
}
