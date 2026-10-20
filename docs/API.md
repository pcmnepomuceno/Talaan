# Talaan: API Contract

Contract first. Applications (milestone 3) and interviews (milestone 4) CRUD are built. All routes live under `/api/v1`, except `/health` and `/ping`, which sit at the root. Items marked **Open** need a decision.

## Auth
- Browsers: `session_token` HttpOnly cookie (30 days).
- Non-browser clients must not depend on cookies alone. v1.1 adds hashed personal API tokens sent as `Authorization: Bearer <token>`; every protected route accepts either.
- Every `/api/v1` response, errors included, carries `Cache-Control: no-store` (one middleware).

## Routes
| Method | Path | Notes |
|---|---|---|
| POST | `/signup` | 201; invite code from v1b |
| POST | `/login` | 200; sets cookie |
| POST | `/logout` | 204 |
| GET | `/me` | current user |
| GET | `/applications` | paginated; `?status=` |
| POST | `/applications` | 201 |
| POST | `/applications/quick` | 201; quick-add |
| GET/PATCH/DELETE | `/applications/{id}` | 200 / 200 / 204 |
| GET | `/applications/{id}/interviews` | paginated |
| POST | `/applications/{id}/interviews` | 201 |
| GET/PATCH/DELETE | `/interviews/{id}` | ownership via parent application |
| GET | `/health` | root (unversioned); DB check (`SELECT 1`); 503 on DB failure |
| GET | `/ping` | root (unversioned); no DB; for uptime pinger |

`/health` and `/ping` are unauthenticated and unversioned so pingers and Render checks survive version bumps (DECISIONS.md, 2026-10-20).

## Status codes
200 OK, 201 Created, 204 No Content (delete, logout), 401 not logged in or bad credentials, 404 not found **or not yours**, 409 duplicate email, 422 validation, 429 rate limited (v1b), 503 `/health` when the database is unreachable.

## Errors
FastAPI default: `{"detail": "message"}`. Validation errors (422) use FastAPI's `detail` list. Clients branch on status code, not on message text.

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

## Saved jobs
New `application_status` value `saved` (first in order) and nullable `date_applied`, via a new migration (DECISIONS.md, 2026-10-20). When a row is not `saved` and `date_applied` is empty (create or PATCH), the server sets it to today in Asia/Manila; a client-sent date always wins. Moving back to `saved` keeps the date. Quick-add and the browser extension create `saved` rows.

## Quick-add
`POST /applications/quick` takes `{"url": "...", "company": "..."?}`. It creates a `saved` application with `contact_website=url`. Because `job_name` is NOT NULL, **Open**: placeholder (the URL's hostname) vs making `job_name` nullable for `saved` rows. Duplicate URLs for the same user: **Open** (409 vs allow).

## Open questions
1. Quick-add `job_name` placeholder and duplicate-URL behavior.
2. Should `status` accept several values (`?status=applied&status=screening`)?
