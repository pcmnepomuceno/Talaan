# Talaan: API Contract

Contract first. Applications (milestone 3) and interviews (milestone 4) CRUD are built. All routes live under `/api/v1`, except `/health` and `/ping`, which sit at the root. Items marked **Open** need a decision.

## Auth
- Browsers: session cookie (30 days), see Cookie below.
- Non-browser clients must not depend on cookies alone. v1.1 adds hashed personal API tokens sent as `Authorization: Bearer <token>`; every protected route accepts either.
- Every `/api/v1` response, errors included, carries `Cache-Control: no-store` (one middleware).

## Routes
| Method | Path | Notes |
|---|---|---|
| POST | `/signup` | requires `invite_code` (M9); currently answers 200, see Signup |
| POST | `/login` | 200; sets cookie |
| POST | `/logout` | 204 |
| GET | `/me` | current user |
| POST | `/account/delete` | body `{"password"}`; 204; permanent, see Account deletion |
| GET | `/applications` | paginated; `?status=` |
| POST | `/applications` | 201 |
| POST | `/applications/quick` | 201; quick-add |
| GET/PATCH/DELETE | `/applications/{id}` | 200 / 200 / 204 |
| GET | `/applications/{id}/interviews` | paginated |
| POST | `/applications/{id}/interviews` | 201 |
| GET | `/interviews` | agenda: the caller's interviews across all applications; `?when=upcoming\|past` (required), paginated |
| GET/PATCH/DELETE | `/interviews/{id}` | ownership via parent application |
| GET | `/health` | root (unversioned); DB check (`SELECT 1`); 503 on DB failure |
| GET | `/ping` | root (unversioned); no DB; for uptime pinger |

`/health` and `/ping` are unauthenticated and unversioned so pingers and Render checks survive version bumps (DECISIONS.md, 2026-10-20).

## Status codes
200 OK, 201 Created, 204 No Content (delete, logout), 401 not logged in or bad credentials, 404 not found **or not yours**, 409 duplicate email, 422 validation, 429 rate limited, 403 wrong password on `/account/delete` or a blocked cross-site request, 400 invalid invite code on `/signup`, 503 `/health` when the database is unreachable, or `/login`, `/signup` and `/account/delete` when the rate limiter cannot reach it (fail closed).

## Errors
FastAPI default: `{"detail": "message"}`. Validation errors (422) use FastAPI's `detail` list. Clients branch on status code, not on message text.

## Cookie
Name `session_token`, or `__Host-session_token` when `COOKIE_SECURE` is true (the default). Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (30 days), no `Domain`, and `Secure` only when `COOKIE_SECURE` is true. Never `SameSite=None`. Logout and account deletion send the same name and attributes with `Max-Age=0`. A plain-http client (curl, Safari on `http://localhost`) does not send a Secure cookie back: set `COOKIE_SECURE=false` in local `.env`.

## Cross-site requests
POST/PUT/PATCH/DELETE (login and signup included) return `403 {"detail": "Cross-site request blocked."}` when `Sec-Fetch-Site` is `cross-site`, or when an `Origin` header is present, not listed in `ALLOWED_ORIGINS`, and `Sec-Fetch-Site` is not `same-origin` (a same-origin request, such as Swagger at `/docs`, skips the list). `ALLOWED_ORIGINS` is a comma-separated list of exact origins, each `http(s)://host[:port]` (default `http://localhost:3000`; case, spaces, a trailing slash and the default port are ignored; `*`, a path, query, fragment or user info fails startup). A request with no `Origin` (curl, scripts) is allowed. GET is never checked. There is no CORS: browsers reach the API through the frontend's Next.js proxy, so the API is same-site from the browser's point of view.

## Account deletion
`POST /account/delete` with `{"password": "..."}` and a valid session cookie. Deletes the user and, permanently, all their applications, interviews and sessions, in one transaction, then clears the cookie.
- `204` deleted. `401` no, expired or already-deleted session (also the loser of two simultaneous deletes). `403 {"detail": "Incorrect password."}` wrong password (not 401, so a client does not treat it as an expired session). `429` too many wrong attempts (5 per user and 10 per IP per 15 minutes; `ACCOUNT_DELETE_*` env). `503` database failure; nothing is deleted. `422` password missing or over 1024 characters (any wrong password up to that, including over 72 bytes, is the same 403).
- Used invite codes stay used (`used_by_user_id` becomes NULL). The same email can sign up again, but only with a new invite code; the old account does not come back.

## Signup
`POST /signup` body: `{"email", "password", "account_name", "invite_code"}`. `invite_code` is required (missing is 422). Codes look like `TLN-XXXX-XXXX-XXXX`; case, dashes, spaces and a pasted line ending are ignored. Admins create codes with `python -m app.admin create-invite` (no HTTP endpoint). A code works once and expires (default 14 days).

Unknown, expired, already used, malformed and over-length codes all return the same `400 {"detail": "Invalid or expired invite code."}`. The code is checked before the email, so `400 {"detail": "Email already exists."}` is only seen with a valid code. Any failed signup (duplicate email, 422, 429) leaves the code unused. Failed attempts count against the signup per-IP limit.

## Rate limits
`POST /login`: 10 attempts per IP and 5 failed attempts per email, per 15 minutes (a successful login removes only its own attempt from the email count; earlier failures stay counted). `POST /signup`: 5 attempts per IP per hour. Over a limit: `429 {"detail": "Too many attempts. Try again later."}` with a `Retry-After` header in seconds. The body is the same for every limit. Blocked attempts are not counted. Defaults come from env (`LOGIN_IP_LIMIT`, `LOGIN_EMAIL_LIMIT`, `SIGNUP_IP_LIMIT` and the `*_WINDOW_SECONDS` pair for each).

The client IP is, in order: the `X-Talaan-Client-IP` header, but only when `PROXY_SECRET` is configured and the request carries exactly that value in `X-Talaan-Proxy-Secret` (constant-time compare; the Next proxy sends both, see DECISIONS.md 2026-11-09); else, with `TRUST_PROXY=true` (only behind a proxy you control), the right-most `X-Forwarded-For` value; else the socket peer. A wrong or missing secret, or an unusable IP value, silently falls back to the next source (never an error). With `ENVIRONMENT=production` the API serves no `/docs`, `/redoc` or `/openapi.json`. Only `/account/delete` among authenticated endpoints is rate limited. `/login` returns the same 401 for an unknown email and a wrong password, including passwords over 72 bytes.

Limits are exact under concurrency (one advisory lock per key; DECISIONS.md). To check by hand, send 20 parallel logins for a fresh email. The result must be exactly 5x 401 and 15x 429:

```bash
EMAIL="burst-$(date +%s)@example.com"
seq 20 | xargs -P20 -I{} curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST http://localhost:8000/api/v1/login \
  -H 'Content-Type: application/json' \
  -d "{\"email\":\"$EMAIL\",\"password\":\"Wr0ng!pass\"}" | sort | uniq -c
#       5 401
#      15 429
```

Inside Docker Compose (`docker compose up -d`), every request from the host reaches the `api` container from the Docker bridge gateway IP (for example `172.18.0.1`), so all local clients (browser, curl, tests by hand) share one per-IP bucket. For local work, raise `LOGIN_IP_LIMIT` and `SIGNUP_IP_LIMIT` (and `LOGIN_EMAIL_LIMIT` if needed) in `.env`; the `api` service reads `.env` through `env_file` (optional file), and its own `DATABASE_URL` still wins. Recreate the container after editing `.env` (`docker compose up -d api`).

Your IP must also have fewer than 5 login attempts in the last 15 minutes, or the per-IP limit (10) answers first (for example 20x 429). For a fresh IP every run, start the server with `TRUST_PROXY=true` and add `-H "X-Forwarded-For: 198.51.100.$((RANDOM % 250 + 1))"`. The same burst with 20 different emails from one IP must give exactly 10x 401 and 10x 429. Restart the server after pulling, because without `--reload` it keeps running the old code.

## Ownership
Another user's application or interview returns **404, never 403**, so IDs cannot be probed. Ownership checks live in shared dependencies.

## Pagination and filtering
Every list is paginated: `?limit=20&offset=0` (default 20, max 100). Response:
```json
{"items": [], "total": 0, "limit": 20, "offset": 0}
```
Interviews list oldest first: `scheduled_at` ascending, ties by `id` ascending (decided 2026-10-21). Applications filter with `?status=applied` (one of the enum values). Default order: newest `created_at` first, ties broken by `id` descending (decided 2026-10-21). A bad `status`, `limit` outside 1-100, or a negative or out-of-range `offset` gives 422.

## PATCH semantics
Partial update. An omitted field is unchanged. `null` clears a nullable field; `null` on a NOT NULL field is 422. Server-managed fields (`id`, `created_by`, `created_at`, `updated_at`) are rejected with 422 (`extra=forbid`, also on POST). `company`, `job_name`, `status`, `mode_of_work` cannot be null; `salary`, `remarks`, `contact_*` and `date_applied` can.

## Interviews
`POST` and `GET` are nested under the application; `GET/PATCH/DELETE` are flat at `/interviews/{id}`. Ownership runs through the parent application: another user's or a missing application or interview is 404. An interview cannot move to another application (`job_application_id` is rejected with 422).
- `scheduled_at` must carry a timezone offset (naive is 422), years 1900-2200; past dates are allowed. Postgres stores the instant, not the sent offset, so the response shows the same instant in UTC (`...Z`).
- `interviewer`: trimmed, 1-200 chars, nullable; a whitespace-only value is 422 (send `null` for none). `remarks`: max 5000, nullable. `outcome` defaults to `pending`.
- PATCH: `null` clears `interviewer` and `remarks` only; `null` on `scheduled_at`, `mode` or `outcome` is 422.

### Agenda: `GET /interviews?when=upcoming|past&limit=&offset=&as_of=`
Every interview under the caller's applications (another user's never appear, in rows or in `total`). `when` is required; a missing or unknown value is 422, as are `limit` outside 1-100 and a negative or out-of-range `offset` (defaults 20 and 0, like `GET /applications`). `upcoming` is `scheduled_at >= now`, ordered `scheduled_at` ascending then `id` ascending; `past` is `scheduled_at < now`, ordered `scheduled_at` descending then `id` descending. `now` is the optional `as_of` (ISO 8601 date-time with a `Z` or `±HH:MM` offset, percent-encoded in the query string since `+` decodes to a space); without it the server clock is used. An `as_of` without an offset, or one that does not parse, is 422. The response echoes `as_of`; a client paging one list sends page 1's `as_of` with every later page so a row crossing the boundary between pages cannot shift the offsets (no skipped or repeated row). Body: `{"items", "total", "limit", "offset", "as_of"}` where each item has the interview fields of `GET /interviews/{id}` plus `company` and `job_name` of its application, so the client needs no per-row request. No migration: the query uses the existing `created_by` and `job_application_id` indexes (DECISIONS.md, F8).

## Saved jobs
New `application_status` value `saved` (first in order) and nullable `date_applied`, via a new migration (DECISIONS.md, 2026-10-20). When a row is not `saved` and `date_applied` is empty (create or PATCH), the server sets it to today in Asia/Manila; a client-sent date always wins. Moving back to `saved` keeps the date. Quick-add and the browser extension create `saved` rows.

## Quick-add
`POST /applications/quick` takes `{"url": "...", "company": "..."?}`. It creates a `saved` application with `contact_website=url`. Because `job_name` is NOT NULL, **Open**: placeholder (the URL's hostname) vs making `job_name` nullable for `saved` rows. Duplicate URLs for the same user: **Open** (409 vs allow).

## Open questions
1. Quick-add `job_name` placeholder and duplicate-URL behavior.
2. Should `status` accept several values (`?status=applied&status=screening`)?
