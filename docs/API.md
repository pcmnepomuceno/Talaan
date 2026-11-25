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
| GET | `/me` | current user, with `is_admin` |
| POST | `/account/delete` | body `{"password"}`; 204; permanent, see Account deletion |
| GET | `/admin/invites` | admin only; every invite, newest first, not paginated; see Admin invites |
| POST | `/admin/invites` | admin only; body `{note?, expires_in_days, password}`; 201 with the code, shown once |
| DELETE | `/admin/invites/{id}` | admin only; 204; an unused invite only |
| GET | `/applications` | paginated; `?status=`, or `?follow_up=true&days=` |
| POST | `/applications` | 201 |
| POST | `/applications/quick` | 201; quick-add |
| POST | `/applications/lookup` | body `{url, exclude_id?}`; the caller's newest application saved from that posting, or null; see Job posting URL |
| GET/PATCH/DELETE | `/applications/{id}` | 200 / 200 / 204 |
| GET | `/applications/{id}/interviews` | paginated |
| POST | `/applications/{id}/interviews` | 201 |
| GET | `/interviews` | agenda: the caller's interviews across all applications; `?when=upcoming\|past` (required), paginated |
| GET | `/interviews/calendar` | month grid: the caller's interviews in a PHT date range; `?from=&to=` (YYYY-MM-DD, both required), not paginated, capped at 200 |
| GET/PATCH/DELETE | `/interviews/{id}` | ownership via parent application |
| GET | `/health` | root (unversioned); DB check (`SELECT 1`); 503 on DB failure |
| GET | `/ping` | root (unversioned); no DB; for uptime pinger |

`/health` and `/ping` are unauthenticated and unversioned so pingers and Render checks survive version bumps (DECISIONS.md, 2026-10-20).

## Status codes
200 OK, 201 Created, 204 No Content (delete, logout), 401 not logged in or bad credentials, 404 not found **or not yours** (and every `/admin/invites` route for a logged-in non-admin), 409 duplicate email, or on `/admin/invites` a used invite that cannot be revoked and the 50-unused cap, 422 validation, 429 rate limited, 403 wrong password on `/account/delete` or `POST /admin/invites`, or a blocked cross-site request, 400 invalid invite code on `/signup`, 503 `/health` when the database is unreachable, or `/login`, `/signup`, `/account/delete` and `POST /admin/invites` when the rate limiter cannot reach it (fail closed).

## Errors
FastAPI default: `{"detail": "message"}`. Validation errors (422) use FastAPI's `detail` list. Clients branch on status code, not on message text.
Every 422 error has `"input": null`: the submitted value is never returned in `input`. `msg` comes from the validator and can quote part of the value (an `EmailStr` error names the invalid characters). A NUL or a lone surrogate in a stored text field is a 422 (rejected, never stripped). The login, account-delete and invite-create passwords are only checked, never stored: a lone surrogate there is a 422 and NUL is accepted. A surrogate left in `loc` or `msg` is written as a `\udxxx` escape.

## Cookie
Name `session_token`, or `__Host-session_token` when `COOKIE_SECURE` is true (the default). Attributes: `HttpOnly`, `SameSite=Lax`, `Path=/`, `Max-Age=2592000` (30 days), no `Domain`, and `Secure` only when `COOKIE_SECURE` is true. Never `SameSite=None`. Logout and account deletion send the same name and attributes with `Max-Age=0`. A plain-http client (curl, Safari on `http://localhost`) does not send a Secure cookie back: set `COOKIE_SECURE=false` in local `.env`.

## Cross-site requests
POST/PUT/PATCH/DELETE (login and signup included) return `403 {"detail": "Cross-site request blocked."}` when `Sec-Fetch-Site` is `cross-site`, or when an `Origin` header is present, not listed in `ALLOWED_ORIGINS`, and `Sec-Fetch-Site` is not `same-origin` (a same-origin request, such as Swagger at `/docs`, skips the list). `ALLOWED_ORIGINS` is a comma-separated list of exact origins, each `http(s)://host[:port]` (default `http://localhost:3000`; case, spaces, a trailing slash and the default port are ignored; `*`, a path, query, fragment or user info fails startup). A request with no `Origin` (curl, scripts) is allowed. GET is never checked. There is no CORS: browsers reach the API through the frontend's Next.js proxy, so the API is same-site from the browser's point of view.

## Account deletion
`POST /account/delete` with `{"password": "..."}` and a valid session cookie. Deletes the user and, permanently, all their applications, interviews and sessions, in one transaction, then clears the cookie.
- `204` deleted. `401` no, expired or already-deleted session (also the loser of two simultaneous deletes). `403 {"detail": "Incorrect password."}` wrong password (not 401, so a client does not treat it as an expired session). `429` too many wrong attempts (5 per user and 10 per IP per 15 minutes; `ACCOUNT_DELETE_*` env). `503` database failure; nothing is deleted. `422` password missing or over 1024 characters (any wrong password up to that, including over 72 bytes, is the same 403).
- Used invite codes stay used (`used_by_user_id` becomes NULL). The same email can sign up again, but only with a new invite code; the old account does not come back.

## Admin invites
`GET`, `POST` and `DELETE /admin/invites` need a session whose current email is listed in `ADMIN_EMAILS` (comma separated, case-insensitive; unset or empty means nobody, so every route answers 404). No session is `401`. A logged-in user who is not an admin gets `404 {"detail": "Not Found"}` on every method, the same body as an unknown path. Known leaks: a non-admin sending malformed JSON gets `422` (FastAPI parses the body before the check), anonymous callers get `401`, not 404, and Starlette answers other methods with `405` plus an `Allow` header (for example `PUT /admin/invites`) and 307-redirects a trailing slash (`/admin/invites/`) to anyone, anonymous included, so the routes can be found. Every response, errors included, carries `Cache-Control: no-store`. `is_admin` (boolean, computed from `ADMIN_EMAILS`) is in the `/me` and `/signup` bodies; it only decides whether the UI shows the Admin link, the server checks the email again on every request.

### `GET /admin/invites`
`200 {"items": [{"id", "status", "note", "created_at", "expires_at", "used_at", "used_by_account_name"}]}`, newest first (`id` descending). `status` is `unused`, `used` or `expired`. `used_by_account_name` is the account name of the user who used it, null when unused or when that account was deleted (`used_at` is still set). There is never a code, a hash or an email.

**Pagination exception:** this list is not paginated and has no `total`, `limit` or `offset`. The cap of 50 applies to unused invites only, so used and expired rows can add up, but at friend-trial scale that is a few dozen. Add `limit` and `offset` like `GET /applications` if it grows.

### `POST /admin/invites`
Body (unknown fields are 422):
- `note`: optional string, stripped; blank becomes null; at most 200 characters (code points).
- `expires_in_days`: required, exactly `7`, `14` or `30`.
- `password`: required, the caller's own password, at most 1024 characters.

`201 {"id", "code", "note", "expires_at"}`. `code` (`TLN-XXXX-XXXX-XXXX`) is in this response only; it is stored as a SHA-256 hash, never logged and never in the list. Errors, in the order they are checked:
- `404` not an admin, `401` no session.
- `429` rate limited (`Retry-After`), the same body as the other limits. `503` when the limiter cannot reach the database (fail closed).
- `403 {"detail": "Incorrect password."}` (not 401, so the client does not treat it as an expired session).
- `409 {"detail": "There are already 50 unused invites. Revoke one or wait for one to expire."}` when 50 unused, unexpired invites exist. Used and expired invites do not count. The CLI is not capped.
- `422` validation (bad `expires_in_days`, note over 200 characters, missing password, extra field).

### `DELETE /admin/invites/{id}`
`204` when an unused invite was deleted. `409 {"detail": "This invite has been used and cannot be revoked."}` for a used one (it stays as the record of who joined). `404 {"detail": "Invite not found."}` when it does not exist, for example an invite already revoked.

## Signup
`POST /signup` body: `{"email", "password", "account_name", "invite_code"}`. `invite_code` is required (missing is 422). Codes look like `TLN-XXXX-XXXX-XXXX`; case, dashes, spaces and a pasted line ending are ignored. Admins create codes on the `/admin` page (the Admin invites endpoints) or with `python -m app.admin create-invite`. A code works once and expires (default 14 days).

Unknown, expired, already used, malformed and over-length codes all return the same `400 {"detail": "Invalid or expired invite code."}`. The code is checked before the email, so `400 {"detail": "Email already exists."}` is only seen with a valid code. Any failed signup (duplicate email, 422, 429) leaves the code unused. Failed attempts count against the signup per-IP limit.

## Rate limits
`POST /login`: 10 attempts per IP and 5 failed attempts per email, per 15 minutes (a successful login removes only its own attempt from the email count; earlier failures stay counted). `POST /signup`: 5 attempts per IP per hour. Over a limit: `429 {"detail": "Too many attempts. Try again later."}` with a `Retry-After` header in seconds. The body is the same for every limit. Blocked attempts are not counted. Defaults come from env (`LOGIN_IP_LIMIT`, `LOGIN_EMAIL_LIMIT`, `SIGNUP_IP_LIMIT` and the `*_WINDOW_SECONDS` pair for each). `POST /admin/invites` allows 10 attempts per user and 10 per IP per hour (`ADMIN_INVITE_USER_*`, `ADMIN_INVITE_IP_*`), every attempt counted, successful ones too.

The client IP is, in order: the `X-Talaan-Client-IP` header, but only when `PROXY_SECRET` is configured and the request carries exactly that value in `X-Talaan-Proxy-Secret` (constant-time compare; the Next proxy sends both, see DECISIONS.md 2026-11-09); else, with `TRUST_PROXY=true` (only behind a proxy you control), the right-most `X-Forwarded-For` value; else the socket peer. A wrong or missing secret, or an unusable IP value, silently falls back to the next source (never an error). With `ENVIRONMENT=production` the API serves no `/docs`, `/redoc` or `/openapi.json`. Among authenticated endpoints only `/account/delete` and `POST /admin/invites` are rate limited. `/login` returns the same 401 for an unknown email and a wrong password, including passwords over 72 bytes.

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
Every list is paginated: `?limit=20&offset=0` (default 20, max 100). The one exception is `GET /admin/invites` (see Admin invites). Response:
```json
{"items": [], "total": 0, "limit": 20, "offset": 0}
```
Interviews list oldest first: `scheduled_at` ascending, ties by `id` ascending (decided 2026-10-21). Applications filter with `?status=applied` (one of the enum values). Default order: newest `created_at` first, ties broken by `id` descending (decided 2026-10-21). A bad `status`, `limit` outside 1-100, or a negative or out-of-range `offset` gives 422, and so does `follow_up=true` together with `status`, or `days` without `follow_up=true` (alone, or with `follow_up=false`; see the follow-up list below).

### Follow-up list: `GET /applications?follow_up=true&days=7`
Applications that have gone quiet. Let `now` be the server clock and `today` the date of `now` in Asia/Manila (PHT, computed in Python, so the server's time zone never matters). An application is in the list when all of these hold:
1. Its `status` is exactly `applied`. `saved` and the other eight statuses are never listed.
2. It has no interview with `scheduled_at >= now`. An interview exactly at `now`, or later today, counts as upcoming, the same boundary as the agenda.
3. `today` minus its last activity day is at least `days`. The last activity day is the later of two days: `date_applied` (or, when it is null, the PHT date of `created_at`; through the API an `applied` row always has `date_applied`) and the PHT date of its latest interview with `scheduled_at < now`. `updated_at` is never used, so editing a note does not reset the clock.

A `date_applied` in the future gives a negative idle count, so that row is not listed.

- `days` defaults to 7 and must be an integer from 1 to 90. It is never clamped: 0, 91 and a non-integer are 422.
- `follow_up=true` with `status` is 422. `days` is only valid with `follow_up=true`: `days` alone, or `follow_up=false` with `days`, is 422. Without `days`, `follow_up=false` or no `follow_up` behaves exactly like the normal list. `limit` and `offset` work as usual.
- Order: last activity day ascending (quietest first), then `id` ascending.
- Body: `{"items", "total", "limit", "offset"}`. Each item has every field of `GET /applications/{id}` plus `idle_days` (integer, `today` minus the last activity day, always at least `days`) and `last_activity` (`"applied"` or `"interview"`; `"interview"` when the interview day is the same as or later than the applied day). Items of the normal list gain no new keys.
- There is no `as_of`. Through the clock alone, a row joins the list only at the end of the order (its last activity is exactly `today - days`, the newest allowed), so a clock crossing PHT midnight between two pages appends rows and never shifts an earlier offset. Writes (a status set back to applied, a deleted upcoming interview, an edited `date_applied`) can add a row anywhere, and the client never patches its cached follow-up list: interview writes and status changes mark it stale (it stays on screen and is refetched), while application create, edit and delete and login, logout and account deletion still drop it. A page fetched after midnight shows `idle_days` one higher than page 1; that is accepted.
- No migration: the existing `created_by` and `job_application_id` indexes serve the query (DECISIONS.md, F10).

## PATCH semantics
Partial update. An omitted field is unchanged. `null` clears a nullable field; `null` on a NOT NULL field is 422. Server-managed fields (`id`, `created_by`, `created_at`, `updated_at`) are rejected with 422 (`extra=forbid`, also on POST). `company`, `job_name`, `status`, `mode_of_work` cannot be null; `salary`, `remarks`, `contact_*`, `job_url` and `date_applied` can.

## Job posting URL
`job_url` is an optional field on applications: create, PATCH, and every read (a list item has it like the detail).
- Rules: trimmed; empty or whitespace-only means `null` (create and PATCH); at most 2,000 code points; only `http` or `https` (any case) with a host; no username or password; no whitespace or control characters; a bad port is invalid. Anything else is 422 with `loc` ending in `job_url`. The value is stored exactly as typed (trimmed), never fetched or rewritten. Non-ASCII hosts are accepted unconverted.
- The server also stores a hidden `job_url_key`, never in any request or response. It is the SHA-256 hex of the normalized URL, recomputed whenever `job_url` is sent and set to null when it is cleared. A PATCH without `job_url` leaves both alone.
- Normalization (used for the key and the lookup only): lowercase scheme and host; drop the default port (`:80` for http, `:443` for https) and keep any other; drop the fragment; drop the trailing slash of the path; drop query parameters starting with `utm_` (any case) and `fbclid`, `gclid`, `mc_cid`, `mc_eid`; sort the remaining parameters. Percent-encoding and path case are never changed, `www.` is kept (no match with the bare host), and a different `jobId` is a different posting.

### `POST /applications/lookup`
Requires a session. Body: `{"url": string, "exclude_id": integer | null}`; unknown fields are 422 (`extra=forbid`). `url` goes through the same rules as `job_url`; missing, null, empty or invalid is 422 (`loc` ends in `url`). `exclude_id` is optional and must be a JSON integer (a string, float or boolean is 422, `loc` ends in `exclude_id`): the row with that id is skipped, so the edit form can ask whether another application shares the posting without matching itself. An id that is not the caller's skips nothing and leaks nothing. A 422 here never contains the submitted value (invalid JSON gives `"input": {}` and a parser-only `ctx.error`). The URL is in the body and never in the query string because query strings reach access logs and proxies; the server never logs it. This route is a POST, so the origin check applies (docs/AUTH.md): the web form's same-origin POST through the Next proxy passes it, and the E2 extension, which calls from its own origin, will need that origin in `EXTENSION_ORIGINS`. Response 200: `{"match": {"id", "job_name", "company"}}` or `{"match": null}`. The match is the caller's own newest application (`created_at`, then `id`, descending) with the same key. Another user's rows are never matched or returned. A GET on this path is not this route: it reaches `GET /applications/{id}` and answers 422. The response is `Cache-Control: no-store` like every `/api/v1` response.

## Interviews
`POST` and `GET` are nested under the application; `GET/PATCH/DELETE` are flat at `/interviews/{id}`. Ownership runs through the parent application: another user's or a missing application or interview is 404. An interview cannot move to another application (`job_application_id` is rejected with 422).
- `scheduled_at` must carry a timezone offset (naive is 422), years 1900-2200; past dates are allowed. Postgres stores the instant, not the sent offset, so the response shows the same instant in UTC (`...Z`).
- `interviewer`: trimmed, 1-200 chars, nullable; a whitespace-only value is 422 (send `null` for none). `remarks`: max 5000, nullable. `outcome` defaults to `pending`.
- PATCH: `null` clears `interviewer` and `remarks` only; `null` on `scheduled_at`, `mode` or `outcome` is 422.

### Agenda: `GET /interviews?when=upcoming|past&limit=&offset=&as_of=`
Every interview under the caller's applications (another user's never appear, in rows or in `total`). `when` is required; a missing or unknown value is 422, as are `limit` outside 1-100 and a negative or out-of-range `offset` (defaults 20 and 0, like `GET /applications`). `upcoming` is `scheduled_at >= now`, ordered `scheduled_at` ascending then `id` ascending; `past` is `scheduled_at < now`, ordered `scheduled_at` descending then `id` descending. `now` is the optional `as_of` (ISO 8601 date-time with a `Z` or `±HH:MM` offset, percent-encoded in the query string since `+` decodes to a space); without it the server clock is used. An `as_of` without an offset, or one that does not parse, is 422. The response echoes `as_of`; a client paging one list sends page 1's `as_of` with every later page so a row crossing the boundary between pages cannot shift the offsets (no skipped or repeated row). Body: `{"items", "total", "limit", "offset", "as_of"}` where each item has the interview fields of `GET /interviews/{id}` plus `company` and `job_name` of its application, so the client needs no per-row request. No migration: the query uses the existing `created_by` and `job_application_id` indexes (DECISIONS.md, F8).

### Calendar: `GET /interviews/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD`
The caller's interviews whose Philippine calendar day (Asia/Manila, UTC+08:00, no DST) falls from `from` to `to`, both days included. The server converts the range to the UTC instants `[from 00:00 PHT, to + 1 day 00:00 PHT)`, so an interview at 23:30 PHT and one at 00:30 PHT the next day land on different days. Ordered `scheduled_at` ascending then `id` ascending. Another user's interviews never appear, in rows or in `total`.
- It is a separate path from the agenda because its answer has another shape (a cap and a `truncated` flag instead of paging and `as_of`). The two modes do not mix: any of `when`, `limit`, `offset` or `as_of` on this route is 422, and `from` or `to` missing is 422.
- `from` and `to` are real calendar dates in exactly the form `YYYY-MM-DD` (`20261101`, `2026-02-30` and `2026-13-01` are 422), years 1900-2200 (like the interview form). `from` must not be after `to`, and the range is at most 62 days (inclusive). Anything else is 422 with FastAPI's `detail` list.
- Body: `{"items", "total", "truncated", "from", "to"}`. `items` has at most 200 rows with the same shape as an agenda item (interview fields plus `company` and `job_name`). `total` counts every match in the range; `truncated` is `total > 200`, in which case the later rows are missing and the client says so. `from` and `to` echo the request as dates.
- No migration: same join and indexes as the agenda (DECISIONS.md, F9).

## Saved jobs
New `application_status` value `saved` (first in order) and nullable `date_applied`, via a new migration (DECISIONS.md, 2026-10-20). When a row is not `saved` and `date_applied` is empty (create or PATCH), the server sets it to today in Asia/Manila; a client-sent date always wins. Moving back to `saved` keeps the date. Quick-add and the browser extension create `saved` rows.

## Quick-add
`POST /applications/quick` takes `{"url": "...", "company": "..."?}`. It creates a `saved` application with `contact_website=url`. Because `job_name` is NOT NULL, **Open**: placeholder (the URL's hostname) vs making `job_name` nullable for `saved` rows. Duplicate URLs for the same user: **Open** (409 vs allow).

## Open questions
1. Quick-add `job_name` placeholder and duplicate-URL behavior.
2. Should `status` accept several values (`?status=applied&status=screening`)?
