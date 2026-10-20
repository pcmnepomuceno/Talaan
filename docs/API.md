# Talaan: API Contract

Contract first; no CRUD exists yet. All routes live under `/api/v1` (existing auth routes move there in v1a). Items marked **Open** need a decision.

## Auth
- Browsers: `session_token` HttpOnly cookie (30 days).
- Non-browser clients must not depend on cookies alone. v1.1 adds hashed personal API tokens sent as `Authorization: Bearer <token>`; every protected route accepts either.
- Every response from an authenticated route carries `Cache-Control: no-store`.

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
| GET | `/health` | DB check (`SELECT 1`) |
| GET | `/ping` | no DB; for uptime pinger |

`/health` and `/ping` are unauthenticated. **Open**: whether they sit outside `/api/v1` (proposal: root, so pingers and Render checks survive version bumps).

## Status codes
200 OK, 201 Created, 204 No Content (delete, logout), 401 not logged in or bad credentials, 404 not found **or not yours**, 409 duplicate email, 422 validation, 429 rate limited (v1b).

## Errors
FastAPI default: `{"detail": "message"}`. Validation errors (422) use FastAPI's `detail` list. Clients branch on status code, not on message text.

## Ownership
Another user's application or interview returns **404, never 403**, so IDs cannot be probed. Ownership checks live in shared dependencies.

## Pagination and filtering
Every list is paginated: `?limit=20&offset=0` (default 20, max 100). Response:
```json
{"items": [], "total": 0, "limit": 20, "offset": 0}
```
Applications filter with `?status=applied` (one of the enum values). Default order: newest `created_at` first (**Open**: sort by `date_applied`?).

## PATCH semantics
Partial update. An omitted field is unchanged. `null` clears a nullable field; `null` on a NOT NULL field is 422. Server-managed fields (`id`, `created_by`, `created_at`) are rejected or ignored.

## Saved jobs
New `application_status` value `saved` (first in order) and nullable `date_applied`, via a new migration (DECISIONS.md, 2026-10-20). When status moves to `applied` and `date_applied` is empty, the server sets it to today. Quick-add and the browser extension create `saved` rows.

## Quick-add
`POST /applications/quick` takes `{"url": "...", "company": "..."?}`. It creates a `saved` application with `contact_website=url`. Because `job_name` is NOT NULL, **Open**: placeholder (the URL's hostname) vs making `job_name` nullable for `saved` rows. Duplicate URLs for the same user: **Open** (409 vs allow).

## Open questions
1. `/health` and `/ping` path (root vs `/api/v1`).
2. Default sort for applications.
3. Quick-add `job_name` placeholder and duplicate-URL behavior.
4. Should `status` accept several values (`?status=applied&status=screening`)?
