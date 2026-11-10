// Small same-origin JSON client for the real API (F4: auth only). Calls go to /api/..., which
// next.config.ts rewrites to the backend, so the HttpOnly session cookie rides along by itself.
// Never stores tokens or user data anywhere in the browser.

export type FieldErrors = Record<string, string>;

export class ApiError extends Error {
  constructor(
    readonly status: number, // 0 = no usable response (network failure, or a 2xx that is not JSON)
    readonly detail: string,
    readonly fieldErrors: FieldErrors = {},
    readonly retryAfterSeconds: number | null = null,
    // The HTTP status was 2xx but reading the body was aborted (a timeout included): the server answered.
    readonly httpOk = false,
  ) {
    super(detail);
    this.name = "ApiError";
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  // A 401 means the session is dead: send the user to /login?expired=1&next=<here>. Login, signup,
  // logout and the login page's own /me probe turn this off (a 401 there is an answer, not expiry).
  redirectOn401?: boolean;
  signal?: AbortSignal; // an abort (a timeout included) is a network error: ApiError(0)
};

export const FALLBACK_NEXT = "/applications";

// Set when a 401 starts the redirect to /login. beforeunload guards check it and do not prompt:
// "Stay" would cancel the redirect and leave the caller on a promise that never settles. Cleared
// when the page is shown again (a bfcache restore after Back keeps module state).
let leaving = false;
export const isLeavingForLogin = () => leaving;
if (typeof window !== "undefined") window.addEventListener("pageshow", () => void (leaving = false));

// Same-origin relative paths only. Rejects anything a browser could resolve to another origin
// ("//host", "/\host", "https:", "javascript:") or that carries control characters; "/login..."
// is rejected too so a successful login never bounces back to the login page.
export function safeNext(raw: string | null | undefined): string {
  if (!raw || raw[0] !== "/" || raw[1] === "/" || raw.includes("\\")) return FALLBACK_NEXT;
  if (/[\u0000-\u001f\u007f]/.test(raw)) return FALLBACK_NEXT;
  try {
    const u = new URL(raw, "http://x.invalid");
    if (u.origin !== "http://x.invalid" || /^\/login(\/|$)/.test(u.pathname)) return FALLBACK_NEXT;
  } catch {
    return FALLBACK_NEXT;
  }
  return raw;
}

// FastAPI 422: detail is [{loc: ["body", "password"], msg: "Value error, Password must ..."}].
function fieldErrorsFrom(detail: unknown): FieldErrors {
  const out: FieldErrors = {};
  if (!Array.isArray(detail)) return out;
  for (const item of detail) {
    const loc: unknown = item?.loc;
    const msg: unknown = item?.msg;
    if (!Array.isArray(loc) || typeof msg !== "string") continue;
    const field = String(loc[loc.length - 1]);
    if (!(field in out)) out[field] = msg.replace(/^Value error, /, "");
  }
  return out;
}

export async function request<T = void>(path: string, opts: Options = {}): Promise<T> {
  const { method = "GET", body, redirectOn401 = true, signal } = opts;
  let res: Response;
  try {
    res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: body === undefined ? { Accept: "application/json" } : { Accept: "application/json", "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch {
    throw new ApiError(0, "Network error");
  }

  if (res.ok) {
    if (res.status === 204) return undefined as T;
    // A 2xx that is not JSON is not our API (wrong BACKEND_URL, a proxy page): never hand callers
    // `undefined` as data. Status 0 gives the retryable "isn't responding" message.
    try {
      return (await res.json()) as T;
    } catch (e) {
      const name = (e as { name?: unknown } | null)?.name; // a DOMException is not always an Error (jsdom)
      const aborted = name === "AbortError" || name === "TimeoutError";
      throw new ApiError(0, "Unexpected response", {}, null, aborted);
    }
  }

  const data: unknown = await res.json().catch(() => null);
  const detailRaw = (data as { detail?: unknown } | null)?.detail;
  const retry = Number.parseInt(res.headers.get("Retry-After") ?? "", 10);
  const error = new ApiError(
    res.status,
    typeof detailRaw === "string" ? detailRaw : res.statusText || "Request failed",
    fieldErrorsFrom(detailRaw),
    Number.isFinite(retry) && retry >= 0 ? retry : null,
  );

  if (res.status === 401 && redirectOn401 && !window.location.pathname.startsWith("/login")) {
    const here = window.location.pathname + window.location.search;
    leaving = true;
    window.location.replace(`/login?expired=1&next=${encodeURIComponent(here)}`);
    // Never settles: the page is being replaced, so the caller must not flash an error state. The
    // caller's `finally` never runs either: a status window it opened (beginMove) stays open until
    // resetCaches(), which login, logout and account deletion call.
    return new Promise<T>(() => {});
  }
  throw error;
}

// User-facing text for the errors every form handles the same way. Returns null for statuses the
// caller maps itself (400/401/422).
export function errorMessage(e: unknown): string | null {
  if (!(e instanceof ApiError)) return "Something went wrong. Try again.";
  // The Origin/Sec-Fetch-Site check (app/security.py) answers 403 on any write. Account deletion
  // checks for its own "Incorrect password." 403 before calling this.
  if (e.status === 403) return "This request was blocked. Reload the page and try again.";
  if (e.status === 429) {
    if (e.retryAfterSeconds === null) return "Too many attempts. Try again later.";
    const minutes = Math.max(1, Math.ceil(e.retryAfterSeconds / 60));
    return `Too many attempts. Try again in about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`;
  }
  if (e.status === 0 || e.status >= 500) return "Talaan isn't responding right now. Try again in a moment.";
  return null;
}
