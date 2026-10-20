# Decision: Session Lifetime

- **Date:** 2025-02-14
- **Decision:** Use a 30-day session lifetime.
- **Rationale:** The application handles low-stakes data—job applications rather than financial or otherwise sensitive information—so the convenience of a longer-lived session outweighs the associated security trade-off.
---

# Decision: Job Application and Interview schema, enums, Alembic baseline

- **Date:** 2026-10-20
- **Decision:** Schema is owned by Alembic (one baseline migration, all four tables). Models match the CLAUDE.md spec with the choices below.
- **ENUMs (native Postgres ENUM types, lowercase snake_case values):**
  - `application_status`: applied, screening, interviewing, offered, accepted, rejected, withdrawn, ghosted
  - `mode_of_work`: on_site, hybrid, remote
  - `interview_mode`: on_site, online, async
  - `interview_outcome`: pending, good, bad (server default `pending`)
  - Tradeoff: native ENUMs enforce values in the DB, but adding a value needs `ALTER TYPE ... ADD VALUE` and removing or renaming one means recreating the type. Alternative was VARCHAR + CHECK, easier to evolve but weaker in the schema.
- **Nullability:** `remarks` is nullable Text on both tables (spec had no `?`; free notes should not be forced). `Interview.interviewer` is nullable because async interviews may have none.
- **Salary convention:** `salary` is an integer holding monthly gross pay in PHP. There is no currency column for now; add one (and a migration) if non-PHP offers need tracking.
- **`date_applied`:** `Date`, not a timestamp, so it does not use the `_at` suffix. The time of day is not meaningful.
- **Timestamps:** `created_at`/`updated_at` are `DateTime(timezone=True)`, NOT NULL, `server_default=now()`; `updated_at` also has ORM-side `onupdate`. Raw SQL updates will not bump `updated_at`; add a trigger if non-ORM writes appear.
- **Foreign keys:** `job_applications.created_by` and `interviews.job_application_id` use `ON DELETE CASCADE` and are indexed (Postgres does not index FK columns automatically, and every CRUD query filters on them). `sessions.user_id` is unchanged for now (see CLAUDE.md backlog).
- **Downgrade:** autogenerate does not drop native enum types, so the baseline `downgrade()` drops them explicitly. Verified: upgrade, `alembic check`, downgrade, upgrade again on a fresh DB.

---

# Decision: Rename ApplyFlow to Talaan

- **Date:** 2026-10-20
- **Decision:** The project is renamed Talaan (Tagalog for "record" or "list"). Container is `talaan-db`, volume `talaan_pgdata`, Postgres user and database `talaan`. Compose no longer defaults the database password; a missing `.env` fails loudly.
- **Rationale:** The name ApplyFlow collides with applyflow.com. The Filipino name also fits the target audience.
- **Alternative:** Keep the name and accept the collision. Rejected because it hurts discoverability and risks confusion.

---

# Correction: Session Lifetime entry date

- **Date:** 2026-10-20
- **Decision:** The "Session Lifetime" entry above is dated 2025-02-14, which is wrong. Git history shows it was added in commit `efce6ae` on 2026-09-11, so the decision dates to 2026-09-11 or earlier. The exact day is unverified. The decision itself is unchanged. The original entry is left as written.

---

# Decision: Invite-code signup

- **Date:** 2026-10-20
- **Decision:** Signup requires an invite code from an env var, behind a swappable `check_signup_allowed()`. Planned for v1b.
- **Rationale:** The app is for friends and family on a free tier. Open signup invites spam and cost.
- **Alternative:** Open signup with email verification; heavier and needs email delivery.

---

# Decision: Bring-your-own LLM keys

- **Date:** 2026-10-20
- **Decision:** Any LLM feature (v1.2+) uses the user's own provider key, encrypted at rest and never logged, through a provider-agnostic layer (LiteLLM).
- **Rationale:** No shared API bill, no key custody by the app owner. The Claude Code login is not an API key and is never used.
- **Alternative:** A single server key; rejected for cost and abuse risk.

---

# Decision: No CV file storage

- **Date:** 2026-10-20
- **Decision:** CV files are never stored. CV features (v2) use an opt-in structured profile only.
- **Rationale:** CVs hold sensitive personal data; not storing them removes a large liability.
- **Alternative:** Store uploads encrypted; rejected as unnecessary risk for a free-tier hobby host.

---

# Decision: Gmail is request-only

- **Date:** 2026-10-20
- **Decision:** Gmail integration (v3) is request-only for allowlisted test users: read on explicit user action, no background inbox scanning.
- **Rationale:** Gmail read scopes are restricted and need Google review; inbox access is highly sensitive.
- **Alternative:** Continuous sync; rejected for privacy and verification cost.

---

# Decision: Calendar is manual first

- **Date:** 2026-10-20
- **Decision:** v1c exports interviews as `.ics` plus an "Add to Google Calendar" link (no OAuth). Auto-sync waits for v3.
- **Rationale:** Covers most of the value with no OAuth scopes or tokens to protect.
- **Alternative:** Calendar API sync now; rejected as premature.

---

# Decision: Neon pooled vs direct URLs

- **Date:** 2026-10-20
- **Decision:** The app connects through Neon's pooled URL; Alembic migrations use the direct URL. `pool_pre_ping=True`.
- **Rationale:** The pooler (PgBouncer, transaction mode) suits many short app connections but is unreliable for migrations (session state, DDL locks).
- **Alternative:** One URL for both; risks flaky migrations or exhausting connections.

---

# Decision: Render + Neon over Render Postgres

- **Date:** 2026-10-20
- **Decision:** Host the API on Render free web service and the database on Neon free Postgres.
- **Rationale:** Render's free Postgres expires after a short period; Neon's free tier does not expire and has a pooler.
- **Alternative:** Render Postgres; rejected because the database would be lost or need paying for.

---

# Decision: Responsive PWA for desktop and mobile

- **Date:** 2026-10-20
- **Decision:** The later frontend (Vercel) is one responsive, mobile-first PWA with a share target ("Share to Talaan"). A native Flutter app is optional and not committed.
- **Rationale:** One codebase covers desktop and phones; the share target gives mobile capture without an app store.
- **Alternative:** Native apps first; rejected for cost and review overhead.

---

# Decision: `saved` status and nullable `date_applied`

- **Date:** 2026-10-20
- **Decision:** Add `saved` to `application_status` (before `applied`) and make `date_applied` nullable. The server sets `date_applied` when status moves to `applied`. Planned for v1a as a new migration; the model is not changed yet.
- **Rationale:** Quick-add and the browser extension must save jobs not yet applied to.
- **Tradeoff:** Postgres cannot drop an enum value, so the downgrade must map `saved` rows and recreate the type. Making `date_applied` nullable again also needs a backfill.
- **Alternative:** A separate `saved_jobs` table; rejected because it duplicates the application fields.

---

# Decision: Idempotent logout (204)

- **Date:** 2026-10-20
- **Decision:** `POST /logout` always returns 204 and clears the `session_token` cookie. It deletes the session row if the token matches one, and succeeds quietly for a missing, invalid, or already-deleted token.
- **Rationale:** Logging out twice is harmless, the response does not reveal whether a token was valid, and it matches the 204 in docs/API.md.
- **Alternative:** 401 for a missing or invalid token; rejected because a repeat or stale logout would error for no security gain.

---

# Decision: /health and /ping at the root, unversioned

- **Date:** 2026-10-20
- **Decision:** `GET /health` (runs `SELECT 1`, 503 on database failure) and `GET /ping` (no database work) live at the root, outside `/api/v1`. Business routes live under `/api/v1`.
- **Rationale:** Uptime pingers and Render's health check should not break when the API version bumps. `/ping` touches no database, so a free uptime pinger can keep a free instance warm without loading Neon.
- **Alternative:** Mount both under `/api/v1`; rejected because every version bump would force a change to deploy and pinger config.

---

# Decision: `saved` migration, date-fill rule, sort, updated_at clock

- **Date:** 2026-10-21
- **Decision:** (1) Migration `saved_status_nullable_date_applied` adds `saved` and makes `date_applied` nullable. It is hand-written because autogenerate misses enum changes. The downgrade raises `RuntimeError` with a row count if any `saved` or NULL-date rows exist, then recreates the enum without `saved`. (2) For a non-`saved` row with no `date_applied`, the server sets today in Asia/Manila (fixed +08:00, no DST, no tzdata); a client date wins; returning to `saved` keeps the date. (3) Default list order is `created_at DESC, id DESC`; the id tiebreaker keeps pages stable. (4) `JobApplication.updated_at` uses `onupdate=clock_timestamp()` because `now()` is frozen for a whole transaction, so a PATCH in the same transaction could not change it.
- **Rationale:** Rows are never silently rewritten on downgrade; one timezone makes the date predictable for a PH user; stable pagination.
- **Alternative:** Auto-map `saved` rows on downgrade (loses data meaning); `sort by date_applied` (NULL for saved rows).

---

# Decision: Interviews CRUD (ownership, order, whitespace, no-store middleware)

- **Date:** 2026-10-21
- **Decision:** (1) Interviews have no owner column; ownership is the parent application's `created_by`. Nested routes reuse `get_owned_application`; by-id routes use `get_owned_interview`, which joins `job_applications` and returns 404 for missing and not-owned alike. (2) Default list order is `scheduled_at ASC, id ASC`: rounds read chronologically and the id tiebreaker keeps pages stable. (3) A whitespace-only `interviewer` is 422, not null (same rule as application names); `null` is the explicit "none". (4) `scheduled_at` must be timezone-aware and between years 1900 and 2200; the instant is stored and returned in UTC, the sent offset is not kept. (5) `Cache-Control: no-store` is set by one middleware on every `/api/v1` response, replacing the per-router dependency. (6) `Interview.updated_at` uses `clock_timestamp()` (ORM-only, no migration).
- **Rationale:** One owner of truth avoids a second column that could drift from the parent. A middleware also covers 401/404/422 responses and `/me`, which a router dependency missed. The year bound stops a 500 from datetime overflow found in the security pass.
- **Alternative:** Denormalized `user_id` on interviews (faster check, can drift); descending order (newest first, but rounds read backwards); coercing blank `interviewer` to null (silent rewrite); storing the offset in a column (more schema for little value, the .ics export uses UTC).

---

# Decision: CI on GitHub Actions

- **Date:** 2026-10-21
- **Decision:** One workflow, `.github/workflows/ci.yml`, runs on every `pull_request` and on `push` to `main` only. It has one job on Python 3.14 (the version in the local venv) with a Postgres 16 service container. Lint, `alembic upgrade head`, `alembic check` and `pytest` run as separate steps. `permissions: contents: read`, a concurrency group cancels older runs on the same branch, and `timeout-minutes: 10` caps a hung run. Config is env vars only: `DATABASE_URL` and `TEST_DATABASE_URL` both point at `talaan_test`, with a throwaway password for the CI-only container. There are no secrets and no committed `.env`.
- **Rationale:** Matches the checks run by hand and costs $0 on the free tier. Limiting `push` to `main` stops a same-repo PR branch from running twice. Separate steps show which check broke.
- **Alternative:** A Python version matrix (more minutes, one deploy target); `push` on all branches (duplicate runs); a repository secret for the DB password (nothing to protect in a throwaway container).
