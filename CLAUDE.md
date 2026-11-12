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
Relationships: Users 1—N Job Applications 1—N Interviews; Users 1—N Sessions.
FKs live on the "many" side only (query `created_by`, never store lists on Users).

**Users** (matches model): id, email (UNIQUE), password_hash, account_name

**Sessions** (matches model; `user_id` ON DELETE CASCADE, indexed): id, token_hash (UNIQUE, SHA-256 hex of the `session_token`
HttpOnly cookie value; raw token never stored), user_id → Users.id, created_at, expires_at
(both `DateTime(timezone=True)`)

**InviteCodes** (matches model): id, code_hash (UNIQUE, SHA-256 hex of the normalized 12-char code; plaintext never stored),
note?, created_at, expires_at, used_at?, used_by_user_id? → Users.id (`ON DELETE SET NULL`, indexed `ix_invite_codes_used_by_user_id`)

**Job Applications** (matches model)
id, company, job_name, contact_website?, contact_email?, status (ENUM),
salary? (int), mode_of_work (ENUM), remarks, date_applied, created_at,
updated_at, created_by → Users.id
- `salary`: monthly gross, PHP, no currency column. `remarks` nullable. `date_applied` is a nullable `Date`; non-`saved` rows get today (Asia/Manila) if none is sent.
  `saved` is first in the status ENUM.
- ENUMs: status = applied/screening/interviewing/offered/accepted/rejected/withdrawn/ghosted;
  mode_of_work = on_site/hybrid/remote.

**Interviews** (matches model)
id, job_application_id → Job Applications.id, interviewer, scheduled_at
(tz-aware; spec renamed from `datetime`, model already uses `scheduled_at`),
mode (ENUM: on_site/online/async), outcome (ENUM: good/bad/pending), remarks,
created_at, updated_at
- `interviewer` and `remarks` nullable. mode = on_site/online/async;
  outcome = pending/good/bad (default pending).

ENUM value lists and column choices are logged in DECISIONS.md (2026-10-20).

## Auth design decisions
- **`BCRYPT_ROUNDS`** (`app/config.py`, default 12): cost for `hash_password` (read at call time) and for the login dummy hash (built once at startup), so they always match. `tests/conftest.py` sets 4; never lower it outside tests. **Must stay fixed after launch**: old hashes keep their cost, so a change reintroduces a timing gap between known and unknown emails (rehash-on-login is a possible future change; DECISIONS.md 2026-11-03).
- **Invite codes** (`app/auth/invites.py`, `app/admin.py`): signup requires `invite_code`. Format `TLN-XXXX-XXXX-XXXX` (12 Crockford base32 chars, 60 bits); input is normalized (non-ASCII rejected; strip, uppercase, drop dashes/whitespace, map O→0 and I/L→1, drop `TLN` only from 15-char input) then SHA-256 hashed. Single use, with expiry. Signup order: rate limit, non-consuming code check, duplicate email, then one transaction: insert user + atomic `UPDATE ... RETURNING` to consume (no row: roll back, same error). Every bad-code case is `400 {"detail": "Invalid or expired invite code."}`. No bypass flag, no admin endpoint; tests make codes with `create_invite` in `tests/conftest.py`. Never log or return a plaintext code except the one-time CLI print. DECISIONS.md 2026-11-03.
- **Rate limits** (`app/auth/rate_limit.py`, Postgres): login per IP and per email, signup per IP; limits from env (`.env.example`). Client IP: `X-Talaan-Client-IP` when `PROXY_SECRET` is set and `X-Talaan-Proxy-Secret` matches (constant-time; sent by `frontend/src/proxy.ts`, which strips client copies), else the socket peer; `TRUST_PROXY=true` uses the right-most `X-Forwarded-For` instead of the socket. `TRUST_PROXY` is the only trust switch (run uvicorn with `--no-proxy-headers`). Limiter DB error returns 503.
- **Session cookie** (`app/auth/cookies.py`, the only place name and attributes live): HttpOnly, SameSite=Lax, Path=/, no Domain, Max-Age = `SESSION_LIFETIME`, Secure from `COOKIE_SECURE` (default true). Secure on: name `__Host-session_token`; off: `session_token`. Never `SameSite=None`. **With `COOKIE_SECURE=true` (the default) a plain-http client such as curl or Safari will not send the cookie; set `COOKIE_SECURE=false` in your local `.env`.** Existing local sessions stop working once because the cookie name changes. Tests force `COOKIE_SECURE=false`; cookie tests patch `config.COOKIE_SECURE` and read the raw `Set-Cookie`.
- **Origin check** (`app/security.py`, middleware inside `no_store`): POST/PUT/PATCH/DELETE get 403 if `Sec-Fetch-Site` is `cross-site`; `same-origin` passes without the list (Swagger at `/docs`); otherwise 403 if `Origin` is present and not in `ALLOWED_ORIGINS` (default `http://localhost:3000`, parsed by `config.parse_origins`: each entry `http(s)://host[:port]`, lowercased, default port dropped; `*` or a malformed entry fails startup). No Origin = allowed (non-browser). No CORS middleware: the frontend proxies through Next.js. DECISIONS.md 2026-11-03.
- **Account deletion** (`POST /api/v1/account/delete`, `app/users/router.py`): hard delete, password required (wrong = 403, not 401), rate limited per user and IP (`ACCOUNT_DELETE_*`), `FOR UPDATE` on the user row then one `DELETE`; FK cascades remove applications, interviews and sessions; `invite_codes.used_by_user_id` goes NULL (code stays used); the user's `login:email:<hash>` rate rows are deleted. Same email can re-signup only with a new invite code.
- **Sessions over JWT**: instant revocation (delete the row); no horizontal-scaling need.
- **Session lifetime 30 days**: `SESSION_LIFETIME` in `app/auth/router.py`, used
  for both `expires_at` and cookie `max_age` (must stay in sync). Rationale in DECISIONS.md.
- **Passwords**: at least 8 characters and at most 72 UTF-8 bytes (bcrypt limit)
  + upper/lower/digit/special; enforced on `UserCreate` only, not `UserLogin`.
- **Login failures return 401** (never 404/400), the same 401 for wrong password
  and unknown email. `/login` returns `{"detail": "Logged in"}` and sets the cookie
  (no token in the body).
- **`/logout` is idempotent**: always 204 and clears the cookie, even for a missing or
  invalid token; deletes the session row if one exists (DECISIONS.md).
- **`get_current_user`** (`app/dependencies.py`): reads cookie, loads Session,
  401 if missing; 401 + deletes row if expired; returns `User`. `GET /me` uses it.
- All Job Application/Interview routes must scope to the caller via
  `get_current_user` (`created_by`; interviews via their parent application).

- **Production mode** (`app/config.py`, `app/main.py`): `ENVIRONMENT=production` hides `/docs`, `/redoc`, `/openapi.json` and refuses to start unless `production_problems()` is empty (`COOKIE_SECURE` true, `BCRYPT_ROUNDS` >= 12, `PROXY_SECRET` set, `ALLOWED_ORIGINS` set to non-local https origins). Checked in `main.py` only, so the admin CLI and alembic need just `DATABASE_URL`.

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
- [x] Frontend F6: interviews create, edit, delete (PHT-only times, full-screen routes, Add interview on the detail, shared `TextAction`); see DECISIONS.md 2026-11-04 (F6)

## Frontend
Next.js (App Router, TypeScript, Tailwind v4, npm) in `frontend/`; deploys to Vercel later (root directory `frontend`). Source of truth for look: `docs/DESIGN.md`; PNGs in `docs/design/` are visual references only.
- Commands (run in `frontend/`): `npm run dev`, `npm run lint`, `npm run typecheck`, `npm test` (Vitest), `npm run build`. Node 24.
- Layout: `src/styles/tokens.css` (all colors, radii, type, shadow as a Tailwind `@theme static` block), `src/app/` (routes, `globals.css`, `icon.svg`), `src/components/`, `src/lib/`, `tests/`.
- Rules: tokens only; no hex outside `tokens.css` (and `app/icon.svg`, enforced by `tests/no-hex.test.ts`); dark mode comes from the variables (`light-dark()` + `color-scheme`), never `dark:` variants; sentence case, no `uppercase`; IBM Plex Sans only (400/500/600), no mono or serif; no component library, CSS-in-JS or animation library; no new dependencies without asking.
- Forms: every form uses `noValidate` and shows our own inline errors; no native validation popups.
- Theme: "system" default, override saved in `localStorage` (`theme` = `light` | `dark`), applied by an inline script in `<head>` before paint.
- Next.js here is newer than common training data; check `frontend/node_modules/next/dist/docs/` before using an unfamiliar API. `agentRules: false` stops `next dev` re-creating `frontend/AGENTS.md`.
- Changing a token: `npm test` runs the WCAG contrast checks from DESIGN.md and fails below the ratio.
- Components (`src/components/`, all shown on `/design` in both themes): `Icon`, `Button` (primary/secondary/ghost/destructive; `href` renders a link), `TextField`, `PasswordField`, `Textarea`, `Select` (`fields.tsx`), `SegmentedControl`, `StatusStamp` (+ `STATUSES`, `OUTCOMES`, `stampLabel`), `StatusFilter` (`status-filter.tsx`: the list's native Status select, replaced the filter tabs), `WakingUp` (`waking-up.tsx`: "Starting up..." polite line after 3 s of a pending request; on the applications screen only before anything has loaded (`loadedOnce`), one copy above `<main>` below 1280 and one inside the h-dvh list pane from 1280), `Banner`, `Logo`, `LogoLink` (`logo.tsx`: the app bar and side nav logo, one link to `/applications`), `ThemeToggle`, `LedgerSheet`, `ApplicationRow`, `InterviewRow`, `DetailRows`, `LedgerSkeleton` (`ledger.tsx`), `Dialog`, `DeleteConfirm`, `StatusDialog` (`dialog.tsx`; radio group + "Update status"), `ToastProvider`/`useToast` (`toast.tsx`), `EmptyState`, `NotFoundState` (own title/link props), `ApplicationForm`, `InterviewForm`, `AgendaRow` and `InterviewMeta` (`ledger.tsx`), `AddToCalendar` and `CalendarGuide` (`calendar.tsx`; the guide is a `Dialog` with `focusTitle`; `available` hides only its trigger, an open guide stays open, `onGone` takes focus on close once the trigger is gone; toast "Calendar file created."), `TextAction` (`button.tsx`: the one 44px text action, tones bar/primary/danger; `BarAction` wraps it). `SegmentedControl` takes `value: null` (nothing chosen), `required`, `error`.
- Lib: `ics.ts` (`buildIcs(item, {now, origin})` -> text or null, `icsFileName`: pure, UTC start from the stored instant, end +1 h, CRLF, fold 75 octets, UID `talaan-interview-<id>@talaan`, never reads notes), `getAgenda(when, offset, asOf?)` in `api.ts` (page 1 omits `asOf`, the server echoes `as_of`; every Load more sends it back, URL-encoded; the agenda cache entry keeps `asOf`), `groupByPhtDay`/`isUpcoming` in `interviews.ts`, `formatDayHeading` in `format.ts`. The agenda cache (`cache.ts`: `getAgenda`/`setAgenda`/`agendaVersion`) is dropped by `clearCaches` and by `clearDetail`/`replaceDetail` (so by every interview and application write and every auth event) and kept by `storeApplication`. `src/lib/types.ts` (API field names: `job_name`, `remarks`, `contact_website`, `mode_of_work`, `scheduled_at`; mode labels and icons via `WORK_MODES`/`INTERVIEW_MODES`, `workModeLabel`, `interviewMode`), `format.ts` (`formatPeso`, `formatDate`, `formatDateTimePHT`, `dateAppliedLabel`; all return null on missing/invalid input, dates always Asia/Manila, date-only strings stay calendar dates), `interviews.ts` (`sortInterviewsByDate`), `pht.ts` (`toPhtInput`, `fromPhtInput`, `phtYearOk`: interview times are Philippine time only, never the browser zone; UTC getters and string rebuilding only), `interview-form.ts` (pure validation, like `application-form.ts`), `use-leave-guard.ts` (`useLeaveGuard`: the one `beforeunload` guard). `api.ts` is the real applications client (all through `request()`): `getApplications(status?, offset?)` -> `{items,total}` (50 per page; the API caps a page at 100 and filters by `status`), `getApplication(id)` (null on 404), `getInterviews(id)` (`limit=100`), `getInterview(id)` (null on 404), `createInterview(appId, input)`, `updateInterview(id, initial, next)`, `deleteInterview(id)` (`updateInterview(appId, id, ...)` and `deleteInterview(appId, id)` take the parent id for the scoped clear; the backend PATCH/DELETE are flat `/interviews/{id}`; same write rules as the application writes: `clearCaches()` first, id-only result, 404 on delete = success), `createApplication`, `updateApplication(id, initial, next)` (PATCH with only changed fields; both resolve to the row's id only and clear the caches before reading the response), `deleteApplication` (404 = success), plus `parseId`, `parseStatus`. Cache rules (`cache.ts`: in-memory per-tab list cache and detail cache, never web storage; each operation sets the new state before notifying, in one synchronous step): application create, edit and delete call `clearCaches()` (also any 404 on a write and a status PATCH with no answer: status 0 or a gateway 502/503/504); login, logout and account deletion call `resetCaches()` (`clearCaches()` plus the end of every status window, since a PATCH answered 401 never settles); `changeStatus(id, status, from)` (resolves to nothing) calls `storeApplication(row, from)`, which patches every cached list from its own rows (`patchList`: replace in `all`; a status list holding the row under another status loses it, `total`/`nextOffset` - 1; the new status inserts it at its `created_at desc, id desc` place inside the held rows or into a complete list; a list whose result cannot be known (row beyond the cursor of an incomplete list, or unknown order) is dropped) and the detail from the server's row, with no refetch (an unmappable response, a 404 or no answer, including the 60 s `STATUS_TIMEOUT_MS`, falls back to `clearCaches()`; a 2xx whose body read the timeout cut off (`ApiError.httpOk`) counts as saved: clear and resolve). List epoch: `beginMove()`/`endMove()` bracket the PATCH; a list response is stored only if `listFresh(stamp)` (stamp unchanged since `clearCaches`/`storeApplication`, no status write in flight), else it waits for `listsSettled()` and is re-issued (page 1 restarts, Load more retries once); `use-detail` guards its application request with a local counter bumped on a status change (not `detailStamp`, which would drop a valid interviews request) (DECISIONS.md 2026-11-10); interview create and edit call `clearDetail(applicationId)`; interview delete calls `replaceDetail(applicationId, page minus the row)` (the detail still refetches); an interview changes no list field, so the list cache and in-flight list responses survive. `loadedOnce()` (set by the first stored list or detail, never reset) gates the waking-up line. `mappers.ts` is the only place that knows the JSON shapes (unknown enum -> `MappingError`; date-only strings untouched; request bodies list fields by name so `contact_email` is never sent) and holds the form <-> API conversions. `application-form.ts`: pure validation mirroring the backend (limits counted in code points, `maxLength` 2x as a typing cap), dirty check, 422 mapping. Components import `../lib/...` relatively; Vitest now has an `@` alias (only app screens use `@`).
- Dialog: native `<dialog>` + `showModal()`; `open` prop is the truth, parent clears it in `onClose`; no scrim-click close; `data-autofocus` picks initial focus; `onClose` fires only for user closes; `DeleteConfirm` `busy` disables both buttons and Escape, and re-opens after a native close. Toast: two always-mounted live regions, success 4s (pauses on mouse hover/focus, not touch), max 3 per kind; dismissing the focused toast moves focus to the next toast or back to where it came from. jsdom has no `showModal`; `tests/setup.ts` stubs open/close/Escape only (not inert or focus trap).
- Component rules: every control at least 44 x 44 (a 36px DESIGN visual sits inside a 44px hit area, focus ring on the visual); fields draw a 2px primary ring over the border (6.2), everything else uses the global `:focus-visible` ring in `@layer base`; fields forward `ref` and native props; status/outcome values must equal the API enums (tested against `app/*/models.py`); icons are inline SVG paths in `icon.tsx` (no icon font); transitions at most 100ms. Tests: RTL + user-event, DOM tests start with `// @vitest-environment jsdom`.

- Routes: `/interviews` (F8 agenda: Upcoming / Past in `?when=past`, `GET /interviews?as_of=` pins the split across pages, a tab switch is a new request generation, Load more busy per tab, PHT day groups, rows link to `/applications/{job_application_id}`, Load more 50, `use-agenda.ts`); `/` redirects to `/applications`; `/login` (wired; `?expired=1`, `?deleted=1`, `?next=`); `(app)` group with the shell (`MainNav` bottom bar under 768, 88px rail from 768, 240px ink side nav from 1280, skip link, `ToastProvider`; toasts clear the bottom nav via `--bottom-nav`); `/applications` and `/applications/[id]` share `(ledger)/screen.tsx` (separate screens under 1280, list + detail panes from 1280, list pane scrolls on its own so selecting a row keeps its scroll); `/applications/[id]/interviews/new` and `.../[interviewId]/edit` (full-screen `InterviewForm` in the shell, outside `(ledger)`; time field "Date and time (Philippine time)", mode required with nothing chosen, outcome default Pending, saving never changes the application status; edit always fetches fresh and treats an interview of another application as not found); `/account` (real user, theme, log out, two-step delete); `/applications/new` and `/applications/[id]/edit` are noindex pages sharing `ApplicationForm` (work mode starts unselected on create; status defaults to Saved; Cancel and the back arrow ask "Discard changes?" only when dirty; `beforeunload` registered only while dirty; the browser Back button and side/bottom nav links are NOT intercepted; success = toast + `router.replace` to the detail keeping `?status=`). Edit always fetches the record fresh. The list is `use-list.ts` (per-status cache, stale-while-revalidate, Load more from `nextOffset` with de-dup (a page with no new row withdraws Load more and refetches page 1), announces "N more applications loaded" in the screen's persistent `role="status"` region (cleared after 5s, on tab switch and on detail change) and moves focus to the first new row); the detail is `use-detail.ts` (a clear shows the skeleton, never pre-write data; the exceptions are an interview deleted in place (`replaceDetail` swaps in the page minus that row in the same step as the clear, so the render takes the cached path and the background refetch replaces it) and a status changed in place (`storeApplication` hands the detail the server's row as its fresh application: no skeleton, no refetch, actions stay enabled; the list pane keeps its rows, loaded pages and scroll) (DECISIONS.md 2026-11-09); after a delete, focus goes to the Interviews heading, or to Add interview when none remain; application and interviews fail separately; cached detail shows with Edit/Delete disabled and `aria-busy` until fresh; a 404 evicts the id from the cache). List and detail responses whose request started before a `clearCaches()` are dropped (`cacheVersion`). A 401 redirect sets `isLeavingForLogin()` so `beforeunload` guards stay quiet. `ThemeSync` in the root layout does cross-tab theme sync. `AppBar` is hidden from 1280.
- Auth wiring (F4): the browser only calls `/api/...` on the Next origin; `src/proxy.ts` rewrites it to `BACKEND_URL` (`frontend/.env.example`, default `http://localhost:8000`, set in Vercel; read per request) and, with `PROXY_SECRET`, adds `X-Talaan-Client-IP` (from `x-real-ip`) and `X-Talaan-Proxy-Secret` while always deleting client-sent copies. `src/lib/http.ts` is the only fetch wrapper (`request`, `ApiError` with `status`/`detail`/`fieldErrors`/`retryAfterSeconds`, `errorMessage`, `safeNext`); a 401 goes to `/login?expired=1&next=...` unless `redirectOn401: false` (login, signup, logout, the login page's `/me` probe). `src/lib/auth.ts`: `login`, `signup`, `logout`, `getMe`, `deleteAccount`. `src/proxy.ts` (Next 16 name for middleware) forwards `/api` (above, no cookie check) and checks that `session_token` or `__Host-session_token` exists on private paths, never touching `/login` or `/design`; a stale cookie is the 401 flow's job (redirecting on it would loop). Never put tokens or user data in web storage. `?next=` always goes through `safeNext`. New fetches must go through `request`.
- Local P1 e2e and screenshots: `e2e-applications.cjs` covers the select, Change status (keyboard, skeleton observer, server-filled date); `e2e-interviews.cjs` has list-pane skeleton observers; `screens-statuses.cjs` shoots all nine statuses and three outcomes. Playwright needs a chromium build matching its version (`PW_CHROMIUM`): with Playwright 1.57 against Chrome 153 (build 1243 wants Playwright 1.63.0) `page.route` handlers never fire and `e2e-applications.cjs` stalls at the "dialog busy" status-failure step (no code regression; 75/75 passes with 1.63.0).
- Local F8 e2e: `frontend/scripts/e2e-agenda.cjs` (same `local-env.cjs`; Los Angeles browser, `ICS_OUT=<dir>` keeps the downloads for an external parser).
- Local F6 e2e and screenshots: `frontend/scripts/{e2e,screens}-interviews.cjs` (same `local-env.cjs`; the e2e runs LA and Auckland browser contexts and a "not found" flash observer). CI also runs `TZ=America/Los_Angeles npm test`.
- Local F5 e2e, seed and screenshots: `frontend/scripts/{e2e,seed,screens}-applications.cjs` (not in CI) share `local-env.cjs`, which starts the API on the `_test` database and `next dev` on free ports (an API port other than a busy :8000), and on exit stops them, truncates the test database and prints that the dev database and a foreign :8000 process were untouched. Playwright via `NODE_PATH`; `PW_CHROMIUM` for a matching browser build.
- Local auth e2e and screenshots: `frontend/scripts/e2e-auth.cjs`, `screens-auth.cjs` (Playwright from `NODE_PATH`, API on the `_test` database with `COOKIE_SECURE=false`, header comments list the setup). Check `ss -ltnp | grep :8000` first: a stray uvicorn from another session can already own the port and may run old code against the dev database.
- Screenshots: run `HIDE_DEV_INDICATOR=1 npm run dev` (hides the Next dev badge). Playwright runs are saved in `frontend/.screenshots/` (gitignored), never committed.

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
