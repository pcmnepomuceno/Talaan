// Real applications client (F5). Screens import only these functions. Every request goes through
// request() in http.ts; every response goes through mappers.ts. Every write updates the in-memory
// caches itself (cache.ts), so no screen can forget to. The rules:
//   - create, edit, delete of an application: clearCaches()
//   - status change: storeApplication(row, from) patches every cache from the server's row (no
//     refetch), inside beginMove()/endMove() so no list page can straddle the PATCH; clearCaches()
//     when that response cannot be mapped, on a 404, or with no answer (network error, 60 s timeout)
//   - interview create and edit: clearDetail(applicationId)
//   - interview delete: replaceDetail(applicationId, page minus the row) (the detail still refetches)
//   - any 404 on a write: clearCaches() (the row, or its application, may be gone)
//   - the agenda cache (cache.ts) is dropped by clearCaches, clearDetail and replaceDetail, so every
//     rule above that calls one of them also drops it; changeStatus's storeApplication keeps it
import { type AgendaKey, beginMove, clearCaches, clearDetail, endMove, getDetail, replaceDetail, storeApplication } from "./cache";
import { ApiError, request } from "./http";
import {
  type ApplicationInput,
  fromApiAgendaPage,
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
import { type AgendaInterview, type Application, type Interview, STATUSES, type Status } from "./types";

export const PAGE_SIZE = 50;
export const INTERVIEWS_LIMIT = 100;
/** A status PATCH that has not answered by then is abandoned (cold start measured at 19 s). */
export const STATUS_TIMEOUT_MS = 60_000;
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

// Create, edit and delete resolve to the row's id only. Once the server has the row the caches are
// stale, so they are cleared first; and a response the client cannot fully map (say a new status)
// must not turn a saved row into an error, whose "Try again" would create a duplicate. The detail
// refetches anyway.

/** Resolves to the new row's id. */
export async function createApplication(input: ApplicationInput): Promise<number> {
  const raw = await request<unknown>(BASE, { method: "POST", body: toCreateBody(input) });
  clearCaches();
  return idOf(raw);
}

/** The one application PATCH. A 404 clears every cache (the row is gone) and rethrows. */
async function patchApplication(id: number, body: unknown, signal?: AbortSignal): Promise<unknown> {
  try {
    return await request<unknown>(`${BASE}/${id}`, { method: "PATCH", body, signal });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
}

/** Sends only the fields that differ from `initial`. Resolves to `id`. */
export async function updateApplication(id: number, initial: ApplicationInput, next: ApplicationInput): Promise<number> {
  await patchApplication(id, toPatchBody(initial, next));
  clearCaches();
  return id;
}

// Gateway statuses from the proxy in front of the API: the request may still reach or finish there.
const NO_ANSWER = new Set([502, 503, 504]);

/**
 * PATCH `{status}` only (the server fills date_applied for a non-saved status; the client never
 * sends a date). `from` is the status on screen before the change. The server's row is written into
 * every cache in one step (storeApplication: the lists are patched, the detail swapped, nothing is
 * refetched); the caches are the result, so nothing is returned. When that response cannot be
 * mapped, or its body read is cut off by the timeout, the row is saved all the same: the caches are
 * cleared instead (skeleton, then a refetch).
 * Rejects with ApiError: a 404 or no answer clears the caches first. No answer is status 0 (network
 * error, a 60 s timeout included) or a gateway 502/503/504: the proxy gave up, the backend may not have.
 */
export async function changeStatus(id: number, status: Status, from: Status): Promise<void> {
  beginMove(); // list pages landing until endMove() may straddle the commit: they are re-issued
  try {
    const raw = await patchApplication(id, { status }, AbortSignal.timeout(STATUS_TIMEOUT_MS));
    let row: Application;
    try {
      row = fromApiApplication(raw);
    } catch {
      clearCaches();
      return;
    }
    storeApplication(row, from);
  } catch (e) {
    // A 2xx whose body read was cut off (the timeout landed mid-body): the server saved the change, so
    // this is the unmappable-response case above: clear the caches and resolve.
    if (e instanceof ApiError && e.httpOk) {
      clearCaches();
      return;
    }
    // No answer (network error, timeout or a gateway 502/503/504): the server may have committed, so
    // nothing cached is trusted. A 500 or 4xx is the API's own answer and is taken as not committed.
    if (e instanceof ApiError && (e.status === 0 || NO_ANSWER.has(e.status))) clearCaches();
    throw e;
  } finally {
    endMove();
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

/**
 * One page of the agenda: the user's interviews across all applications, with each application's
 * company and job title. Upcoming is oldest first, past newest first. `total` counts every match.
 * Page 1 omits `asOf` and the server answers with the instant it split at; every later page of the
 * same list sends that `asOf` back, so a row crossing the boundary cannot shift the offsets.
 */
export async function getAgenda(when: AgendaKey, offset = 0, asOf?: string): Promise<Page<AgendaInterview> & { asOf: string }> {
  const q = new URLSearchParams({ when, limit: String(PAGE_SIZE), offset: String(offset) });
  // URLSearchParams percent-encodes the value: a raw "+08:00" would arrive as " 08:00".
  if (asOf !== undefined) q.set("as_of", asOf);
  return fromApiAgendaPage(await request<unknown>(`${INTERVIEWS}?${q}`));
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

// Interview writes follow the F5 rule: the cache is updated as soon as the server has the row, before
// the response is read, and only the id comes back. Saving never touches the application's status.
// Only that application's detail is touched (an interview changes no list field); a 404 clears
// everything, because the application itself may be gone and the lists stale.

/** Rejects with ApiError(404) when the application is gone. Resolves to the new interview's id. */
export async function createInterview(applicationId: number, input: InterviewInput): Promise<number> {
  let raw: unknown;
  try {
    raw = await request<unknown>(`${BASE}/${applicationId}/interviews`, { method: "POST", body: toInterviewCreateBody(input) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
  clearDetail(applicationId);
  return idOf(raw);
}

/** `applicationId` is the interview's parent. Sends only the changed fields. Resolves to `id`; rejects with ApiError(404) when it is gone. */
export async function updateInterview(applicationId: number, id: number, initial: InterviewInput, next: InterviewInput): Promise<number> {
  try {
    await request<unknown>(`${INTERVIEWS}/${id}`, { method: "PATCH", body: toInterviewPatchBody(initial, next) });
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) clearCaches();
    throw e;
  }
  clearDetail(applicationId);
  return id;
}

/**
 * 404 means it is already gone, which is what the caller wanted: resolves either way (and clears
 * everything then). On success the cached detail is replaced by its page minus this row in one step
 * (replaceDetail), so the open detail keeps showing the page while it refetches, never a skeleton.
 */
export async function deleteInterview(applicationId: number, id: number): Promise<void> {
  try {
    await request(`${INTERVIEWS}/${id}`, { method: "DELETE" });
  } catch (e) {
    if (!(e instanceof ApiError && e.status === 404)) throw e;
    clearCaches();
    return;
  }
  const cached = getDetail(applicationId);
  if (cached?.interviews) {
    const { items, total } = cached.interviews;
    replaceDetail(applicationId, { ...cached, interviews: { items: items.filter((i) => i.id !== id), total: Math.max(0, total - 1) } });
  } else clearDetail(applicationId);
}
