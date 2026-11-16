# Talaan — Job Application Tracker

Personal job-application tracker: log applications, track status changes,
record interview rounds. Portfolio project, built in **build mode**: Claude
Code implements, I specify, review, and ask for explanations (see Working
Agreement). The earlier learn-by-writing workflow is preserved in
`docs/learning-mode.md`.

**Source of truth for scope: `docs/ROADMAP.md`.** Before starting a task, read
the **Current milestone** in `docs/ROADMAP.md`. Other docs: `docs/PROJECT_BRIEF.md`,
`docs/ARCHITECTURE.md`, `docs/API.md` (contract before CRUD).

## Stack
- FastAPI (Python), SQLAlchemy, PostgreSQL 16 (Docker)
- Password hashing: `bcrypt` directly (`passlib` dropped: unmaintained, broken on bcrypt 5.x)
- Docker: set `COOKIE_SECURE=false` in `.env` first (plain http), then `docker compose up -d` (db + api on :8000), then `docker compose run --rm api python -m alembic upgrade head` (never auto-run).
  The `api` service reads `.env` via `env_file` (`required: false`); its own `DATABASE_URL` wins. Inside Compose every host request comes from the bridge gateway IP, so all local clients share one rate-limit bucket: raise the `LOGIN_*`/`SIGNUP_*` limits in `.env` for local work.
- Invites (admin CLI, uses `DATABASE_URL`): `python -m app.admin create-invite [--note TEXT] [--expires-in 14d]` (prints the code once), `list-invites`, `revoke-invite ID` (unused only), `purge` (old `rate_limit_events` and expired `sessions`, batched, `SKIP LOCKED`; daily via `.github/workflows/purge.yml`). In Docker: `docker compose run --rm api python -m app.admin ...`.
- Run: `cp .env.example .env` (then set `COOKIE_SECURE=false` in `.env` for plain http; the default true is for production), `docker compose up -d db`, `pip install -r requirements-dev.txt`,
  `alembic upgrade head`, `uvicorn app.main:app --reload --no-proxy-headers`
  (`--no-proxy-headers` keeps uvicorn from rewriting the client address from `X-Forwarded-For`;
  `TRUST_PROXY` in `.env` is the only trust switch, default false)
- Migrations: `alembic revision --autogenerate -m slug` (review the output), `alembic upgrade head`,
  `alembic check` (models match migrations)
- Tests: one-time `docker compose exec db createdb -U talaan talaan_test`, then `pytest`
  from the repo root with the venv active. Uses `TEST_DATABASE_URL` (else `DATABASE_URL` + `_test`);
  aborts unless the DB name ends in `_test`. Schema via `alembic upgrade head`; each test rolls back.

## Schema
Tables, columns and ENUMs: docs/ARCHITECTURE.md (Schema section). FKs live on the "many" side only: query `created_by`, never store lists on Users. Schema changes go through Alembic only.

## Security rules
Auth decisions (sessions, cookies, invites, rate limits, origin check, account deletion): docs/AUTH.md. Rules that always apply:
- Every application and interview route scopes to the caller through `get_current_user` (`created_by`; interviews via their parent application).
- Never log or return a plaintext invite code (only the one-time CLI print). Never use `SameSite=None`.
- The session cookie's name and attributes live only in `app/auth/cookies.py`. Tokens never go in the response body or in web storage.
- `BCRYPT_ROUNDS` stays fixed after launch; never lower it outside tests.
- Production refuses to start with insecure config (`production_problems()` in `app/config.py`).

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

## Structure
Domain packages (`app/`). Applications and interviews have CRUD. A middleware in `main.py` sets `Cache-Control: no-store` on every `/api/v1` response.

    app/main.py, config.py, database.py, health.py, security.py (Origin check)
    app/auth/          router, schemas, models [Session, RateLimitEvent, InviteCode], dependencies, security, cookies, rate_limit, invites
    app/admin.py       CLI: python -m app.admin {create-invite,list-invites,revoke-invite,purge}
    app/users/         router (/me, /account/delete), schemas, models
    app/applications/  models, schemas, router, dependencies (service planned)
    app/interviews/    models, schemas, router (incl. `GET /interviews` agenda, `_now()` is the clock tests pin), dependencies (service planned)
    tests/             mirrors app/

Routers mount under `/api/v1` (`/api/v1/signup`, `/login`, `/logout`, `/me`).
`/health` (SELECT 1, 503 on DB failure) and `/ping` (no DB) are unversioned at the root.
`alembic/env.py` imports each domain's `models` module; add new domains there.

## Status
- [x] Users/Sessions models; Postgres via docker-compose
- [x] `POST /signup`, `/login`, `/logout`; `get_current_user`; `GET /me`
- [x] Real `/health` (SELECT 1, 503 on failure) and `/ping`, unversioned at root
- [x] Alembic set up; baseline migration for all four tables
- [x] `JobApplication`/`Interview` models match schema
- [x] Login 401, no token in login body, idempotent logout 204
- [x] Auth + health tests (pytest + httpx; 23 tests, `_test` database)
- [x] M8: login/signup rate limiting in Postgres (`rate_limit_events`; per IP and per email; 429 + `Retry-After`; 503 fail closed), constant-work login (dummy hash), 72-byte login guard; tests: see CI. See DECISIONS.md 2026-11-03
- [x] M9: invite-code signup (`invite_codes` table, hashed single-use codes with expiry, `python -m app.admin` CLI, atomic consume; see DECISIONS.md 2026-11-03)
- [x] M10: account deletion (`POST /account/delete`), cookie flags + `__Host-` name, Origin/Sec-Fetch-Site check, `sessions.user_id` ON DELETE CASCADE; see DECISIONS.md 2026-11-03
- [ ] Manually exercise the app end-to-end (`/docs`, curl cookie jar, psql)
- [x] Domain layout move; routers under `/api/v1`
- [x] Applications CRUD (ownership 404, pagination, status filter, `saved` migration; 64 tests)
- [x] Interviews CRUD (ownership through the parent application; 127 tests)
- [x] Dockerfile for the API; compose with db (non-root, slim, 1 worker)
- [ ] Deploy
- [x] Frontend F1: scaffold, tokens, theme, logo, `/design`, tests, CI job (see ROADMAP.md)
- [x] Frontend F2a: icon, button, fields, segmented control, stamp, filter tabs (replaced by a select in P1), banner; `/design` gallery; RTL tests
- [x] Frontend F2b: ledger rows, detail/interview rows, dialog + delete confirm, toasts, empty state, skeleton, PHT formatters, API types
- [x] Frontend F3: app shell, responsive layout, login/applications/detail/account on mock data (`src/lib/api.ts`)
- [x] Frontend F4: auth wired through Next rewrites (login, sign-up with invite, logout, `proxy.ts` guard, 401 handling, Account screen with real user and two-step delete); see DECISIONS.md 2026-11-03 (F4)
- [x] Frontend F5: applications on the real API (list with server-side `?status=` and Load more, detail with stale-while-revalidate, create/edit form, delete); interviews were read-only until F6; see DECISIONS.md 2026-11-03 (F5)
- [x] M11: client IP behind the Vercel rewrite (`PROXY_SECRET`, `X-Talaan-Client-IP`), `ENVIRONMENT=production` (docs off, refuses insecure config), `python -m app.admin purge` + daily GitHub Actions job; see DECISIONS.md 2026-11-09 and docs/DEPLOY.md
- [x] Frontend P1 polish (in review): logo link, status select, Change status dialog (`changeStatus`: PATCH `{status}` only, the server's row patched into every cache, no skeleton, no refetch; busy keeps focus via aria-disabled; DECISIONS.md 2026-11-09 P1, superseded in part by 2026-11-10), waking-up line, interview writes clear one detail; DESIGN.md v2.3
- [x] Frontend F8 (in review): `GET /interviews?when=upcoming|past` agenda endpoint (no migration), Interviews screen and third nav destination, per-interview `.ics` download (`src/lib/ics.ts`), import guide dialog; DESIGN.md v2.4; see DECISIONS.md 2026-11-11
- [x] Frontend F9 (in review): `GET /interviews/calendar?from=&to=` (PHT date range, 62 days max, 200 rows + `truncated`, no migration), a Month view on the Interviews screen (`?view=month&month=&day=`, `MonthGrid`, `use-calendar.ts`, keyboard date grid, `router.replace` only), calendar range cache cleared with the agenda; DESIGN.md v2.5; see DECISIONS.md 2026-11-12 (F9)
- [x] Frontend F6: interviews create, edit, delete (PHT-only times, full-screen routes, Add interview on the detail, shared `TextAction`); see DECISIONS.md 2026-11-04 (F6)

## Frontend

Frontend reference (components, lib, routes, cache rules, auth wiring, e2e details): docs/FRONTEND.md. Look: docs/DESIGN.md.
Next.js (App Router, TypeScript, Tailwind v4, npm) in `frontend/`; deploys to Vercel (root directory `frontend`).
- Commands (run in `frontend/`): `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest), `npm run build`. Node 24.
- Rules: tokens only; no hex outside `tokens.css` (and `app/icon.svg`, enforced by `tests/no-hex.test.ts`); dark mode comes from the variables (`light-dark()` + `color-scheme`), never `dark:` variants; sentence case, no `uppercase`; IBM Plex Sans only (400/500/600), no mono or serif; no component library, CSS-in-JS or animation library; no new dependencies without asking.
- Forms: every form uses `noValidate` and shows our own inline errors; no native validation popups.
- Next.js here is newer than common training data; check `frontend/node_modules/next/dist/docs/` before using an unfamiliar API. `agentRules: false` stops `next dev` re-creating `frontend/AGENTS.md`.
- Components: every control at least 44 x 44; status/outcome values equal the API enums; icons are inline SVG paths in `icon.tsx`; transitions at most 100ms; DOM tests start with `// @vitest-environment jsdom`. Component list and rules: docs/FRONTEND.md.
- Auth: the browser only calls `/api/...` on the Next origin; all fetches go through `request` in `src/lib/http.ts`; `?next=` always goes through `safeNext`; never put tokens or user data in web storage.
- Local e2e: `node frontend/scripts/e2e-<name>.cjs` (Playwright via `NODE_PATH`, matching chromium via `PW_CHROMIUM`); `scripts/local-env.cjs` starts the API on the `_test` database and `next dev` on free ports (`E2E_API_PORT=8100` keeps the API off :8000), and prints that the dev database was untouched. Screenshots: `HIDE_DEV_INDICATOR=1 npm run dev`, saved to gitignored `frontend/.screenshots/`. Details: docs/FRONTEND.md.

## Backlog
- PATCH has no optimistic concurrency (no ETag/version): concurrent edits are last-write-wins
- No-store middleware matches the prefix `/api/v1`, so a future `/api/v10` would match too; use `/api/v1/`
- Signup reveals whether an email exists ("Email already exists"), but only to holders of a valid invite code (M9); email verification is the full fix
- Stale stub docstrings in `app/` reference the old learning-mode rules and passlib; clean up.
- Google OAuth signup: needs nullable `password_hash` + `auth_provider`/`google_id`
  (or an `oauth_identities` table) and a rule for email collisions with local accounts
- `/signup` returns 400/200 where API.md says 409/201; tests in `tests/auth/test_signup.py`
  assert the current behavior and must change when aligned
- `/signup` check-then-insert race: concurrent duplicate hits the unique constraint (500); catch `IntegrityError`
- Rate limits cover `/login` and `/signup` only, not authenticated routes
- Successful logins count against the per-IP limit; a shared IP (campus, office) can hit it (accepted, DECISIONS.md 2026-11-03)
- Tests: starlette warns `httpx` is deprecated for `TestClient` (suggests `httpx2`); revisit
