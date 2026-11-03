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
  idOf,
  type InterviewInput,
  type Page,
  toCreateBody,
  toInterviewCreateBody,
  toInterviewPatchBody,
  toPatchBody,
} from "./mappers";
import { type Application, type Interview, STATUSES, type Status } from "./types";

export const PAGE_SIZE = 50;
export const INTERVIEWS_LIMIT = 100;
const BASE = "/api/v1/applications";
const INTERVIEWS = "/api/v1/interviews"; // flat: GET/PATCH/DELETE by interview id

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

// The writes resolve to the row's id only. Once the server has the row the caches are stale, so they
// are cleared first; and a response the client cannot fully map (say a new status) must not turn a
// saved row into an error, whose "Try again" would create a duplicate. The detail refetches anyway.

/** Resolves to the new row's id. */
export async function createApplication(input: ApplicationInput): Promise<number> {
  const raw = await request<unknown>(BASE, { method: "POST", body: toCreateBody(input) });
  clearCaches();
  return idOf(raw);
}

/** Sends only the fields that differ from `initial`. Resolves to `id`. */
export async function updateApplication(id: number, initial: ApplicationInput, next: ApplicationInput): Promise<number> {
  try {
    await request<unknown>(`${BASE}/${id}`, { method: "PATCH", body: toPatchBody(initial, next) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
  clearCaches();
  return id;
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

/** null = not found (missing, or under another user's application). */
export async function getInterview(id: number): Promise<Interview | null> {
  try {
    return fromApiInterview(await request<unknown>(`${INTERVIEWS}/${id}`));
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

// Interview writes follow the F5 rule: caches are cleared as soon as the server has the row, before
// the response is read, and only the id comes back. Saving never touches the application's status.

/** Rejects with ApiError(404) when the application is gone. Resolves to the new interview's id. */
export async function createInterview(applicationId: number, input: InterviewInput): Promise<number> {
  let raw: unknown;
  try {
    raw = await request<unknown>(`${BASE}/${applicationId}/interviews`, { method: "POST", body: toInterviewCreateBody(input) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
  clearCaches();
  return idOf(raw);
}

/** Sends only the fields that differ from `initial`. Resolves to `id`; rejects with ApiError(404) when it is gone. */
export async function updateInterview(id: number, initial: InterviewInput, next: InterviewInput): Promise<number> {
  try {
    await request<unknown>(`${INTERVIEWS}/${id}`, { method: "PATCH", body: toInterviewPatchBody(initial, next) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
  clearCaches();
  return id;
}

/** 404 means it is already gone, which is what the caller wanted: resolves either way. */
export async function deleteInterview(id: number): Promise<void> {
  try {
    await request(`${INTERVIEWS}/${id}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
  }
  clearCaches();
}
