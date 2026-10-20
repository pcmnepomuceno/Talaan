# ApplyFlow — Job Application Tracker

Personal job-application tracker: log applications, track status changes,
record interview rounds. Portfolio project, built in **build mode**: Claude
Code implements, I specify, review, and ask for explanations (see Working
Agreement). The earlier learn-by-writing workflow is preserved in
`docs/learning-mode.md`.

## Stack
- FastAPI (Python), SQLAlchemy, PostgreSQL 16 (Docker)
- Password hashing: `bcrypt` directly (`passlib` dropped: unmaintained, broken on bcrypt 5.x)
- Run: `cp .env.example .env`, `docker compose up -d db`, `pip install -r requirements-dev.txt`,
  `alembic upgrade head`, `uvicorn app.main:app --reload`
- Migrations: `alembic revision --autogenerate -m slug` (review the output), `alembic upgrade head`,
  `alembic check` (models match migrations)
- Tests: none yet (pytest planned)

## Schema
Relationships: Users 1—N Job Applications 1—N Interviews; Users 1—N Sessions.
FKs live on the "many" side only (query `created_by`, never store lists on Users).

**Users** (matches model): id, email (UNIQUE), password_hash, account_name

**Sessions** (matches model): id, token (UNIQUE, value of the `session_token`
HttpOnly cookie), user_id → Users.id, created_at, expires_at
(both `DateTime(timezone=True)`)

**Job Applications** (matches model)
id, company, job_name, contact_website?, contact_email?, status (ENUM),
salary? (int), mode_of_work (ENUM), remarks, date_applied, created_at,
updated_at, created_by → Users.id
- `salary`: monthly gross, PHP, no currency column. `remarks` nullable. `date_applied` is a `Date`.
- ENUMs: status = applied/screening/interviewing/offered/accepted/rejected/withdrawn/ghosted;
  mode_of_work = on_site/hybrid/remote.

**Interviews** (matches model)
id, job_application_id → Job Applications.id, interviewer, scheduled_at
(tz-aware; spec renamed from `datetime`, model already uses `scheduled_at`),
mode (ENUM: on-site/online/async), outcome (ENUM: good/bad/pending), remarks,
created_at, updated_at
- `interviewer` and `remarks` nullable. mode = on_site/online/async;
  outcome = pending/good/bad (default pending).

ENUM value lists and column choices are logged in DECISIONS.md (2026-10-20).

## Auth design decisions
- **Sessions over JWT**: instant revocation (delete the row); no horizontal-scaling need.
- **Session lifetime 30 days**: `SESSION_LIFETIME` in `app/routes/auth.py`, used
  for both `expires_at` and cookie `max_age` (must stay in sync). Rationale in DECISIONS.md.
- **Passwords**: at least 8 characters and at most 72 UTF-8 bytes (bcrypt limit)
  + upper/lower/digit/special; enforced on `UserCreate` only, not `UserLogin`.
- **Login/logout failures return 401** (never 404/400); login gives the same
  401 for wrong password and unknown email. **Code currently returns 400 for
  both (`app/routes/auth.py`): fix pending (see Status).**
- **`get_current_user`** (`app/dependencies.py`): reads cookie, loads Session,
  401 if missing; 401 + deletes row if expired; returns `User`. `GET /me` uses it.
- All Job Application/Interview routes must scope to the caller via
  `get_current_user` (`created_by`; interviews via their parent application).

## Working Agreement (build mode)
1. **Claude Code implements**: models, schemas, routes, validation, auth,
   tests, Docker, deploy config. I describe the milestone; you build it.
2. **Plan first** for anything touching multiple files. Keep steps small,
   testable, and commit-sized. Ask before adding dependencies.
3. **Explain non-trivial decisions** (security, data model, concurrency,
   tradeoffs) in a few lines: what you chose, why, and the alternative. I may
   ask "walk me through X"; answer at interview level.
4. **Verify, don't assert**: run the tests/app and report what you actually
   ran. Tell me how to check it myself.
5. **Secrets stay out of git**: real config in `.env` (gitignored); only
   `.env.example` with placeholders is committed.
6. **If I approve something I clearly can't explain**, flag it once, briefly,
   and offer an explanation. Don't block progress.

Decision changes get a new dated entry in DECISIONS.md (append; never rewrite old entries).

## Conventions
- Sync routes and sync SQLAlchemy (no `async def` unless every call inside is non-blocking).
- DB-backed checks (ownership, existence) live in dependencies, reused across routes.
- Schema changes go through Alembic migrations only (reversible, `YYYY-MM-DD_slug.py`); never `create_all`.
- Datetime columns are tz-aware and end in `_at`.
- Lint/format with `ruff`; tests in `tests/` mirroring `app/`.
- Ask before adding dependencies.

## Planned structure (not yet applied)
**Current:** `app/` is organized by file type (`models/`, `routes/`, `schemas/`,
plus `dependencies.py`, `security.py`).

**Planned:** domain packages, done as a separate move-only commit with no
behavior change, AFTER the auth tests exist and BEFORE any CRUD code:

    app/main.py, config.py, database.py
    app/auth/          router, schemas, models [Session], dependencies, security
    app/users/         router, schemas, models
    app/applications/  router, schemas, models, service, dependencies
    app/interviews/    router, schemas, models, service
    tests/             mirroring app/

**Rule:** do not build Job Applications/Interviews CRUD before this move.

## Status
- [x] Users/Sessions models; Postgres via docker-compose
- [x] `POST /signup`, `/login`, `/logout`; `get_current_user`; `GET /me`
- [x] `/health` exists (bare `{"status":"ok"}`, no DB check)
- [x] Alembic set up; baseline migration for all four tables
- [x] `JobApplication`/`Interview` models match schema
- [ ] Fix login/logout failures to 401 (see Auth)
- [ ] Auth tests (pytest + httpx)
- [ ] Manually exercise the app end-to-end (`/docs`, curl cookie jar, psql)
- [ ] Move to domain layout (after auth tests, before CRUD)
- [ ] Pydantic schemas + CRUD routes for applications and interviews (with ownership checks)
- [ ] Dockerfile for the API; compose with db
- [ ] Deploy

## Backlog
- `/health` should run `SELECT 1` via `get_db`
- `/login` also returns `session_token` in the JSON body, exposing it to JS
  (defeats HttpOnly); drop it from the response
- Signup reveals whether an email exists ("Email already exists"); decide whether to accept or change
- `sessions.user_id` FK: add `ON DELETE CASCADE` and an index (new migration)
- Stale stub docstrings in `app/` reference the old learning-mode rules and passlib; clean up
  (fits the domain move)
- Google OAuth signup: needs nullable `password_hash` + `auth_provider`/`google_id`
  (or an `oauth_identities` table) and a rule for email collisions with local accounts
