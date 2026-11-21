# Talaan Roadmap

**Current milestone:** A1 (admin page for invites at `/admin`, `ADMIN_EMAILS`, no migration) is done, merged (PR #33) and live; `ADMIN_EMAILS` is set in Render. The next milestone is the Chrome extension: S0, E1, E2, E3, E4 (see Chrome extension below). Before A1: friend-trial prep (licence, first-visit wording, invitee README, clearer invite listing) on branch chore/licence-and-trial. F10 (follow-up list, `GET /applications?follow_up=true&days=`, the Needs follow-up view in the Status select, DESIGN.md v2.6) is done and merged in PR #29. F9 (calendar view, `GET /interviews/calendar`, Month view on the Interviews screen, DESIGN.md v2.5) is done and merged in PR #25, after F8 (agenda, `.ics`, import guide) in PR #24. Deferred, not in any batch: drag to reschedule, adding an interview from a day, week or day views, application dates in the grid, subscription feed, a duration field, swipe actions, demo account, README screenshots.

## Roadmap

Committed:
- v1a core tracker: auth fixes + tests; domain layout move; applications CRUD with status filter + pagination; `saved` application status + nullable `date_applied` (new migration); interviews; per-user isolation; real /health with a DB check; Docker; CI.
- v1b multi-user hardening, then DEPLOY: invite-code signup via env var behind a swappable check_signup_allowed(); rate limiting on login/signup; account deletion (sessions.user_id ON DELETE CASCADE migration + delete-account endpoint); hashed session tokens (token -> token_hash migration); SameSite=Lax and Secure via config; deploy to Render + Neon. Ship here before v1c.
- v1c Filipino job-seeker features: interview export as .ics plus an "Add to Google Calendar" link (no OAuth); follow-up list (applied N days ago, no update; done in F10, merged in PR #29); documents checklist per application (NBI, TIN, SSS, PhilHealth, Pag-IBIG, TOR, diploma); rule-based scam red-flag check (asks for fees, personal-email domain, no company details).
- v1.1: the Chrome extension and phone capture, in the order S0, E1, E2, E3, E4 (Chrome extension section below); scam checks on captured jobs.

Optional (decide after 3-5 friends have used it):
- v1.2: LiteLLM provider-agnostic layer (BYO key, encrypted at rest, never logged) + paste-an-email status suggestion with approval; rule/regex baseline first.
- v2: CV tailoring (fabrication guard, TF-IDF baseline, opt-in structured profile only, no CV files stored), then a text-only interview trainer. Build one before the other.
- v2.5: job discovery from legitimate feeds only (ATS public APIs, Remotive with attribution); scraping optional and self-hosted only.
- v3: Google integration: Calendar auto-sync; Gmail email-to-status for allowlisted test users only.

Skipped on purpose: voice mock interviews, auto-apply bots, server-side scraping of boards that forbid it.

## Frontend

Next.js app in `frontend/`, built from `docs/DESIGN.md`. Each milestone is mergeable alone.
- F1: scaffold and tokens (Next.js, Tailwind theme from tokens, theme handling, font, logo, `/design`, contrast and no-hex tests, CI job).
- F2: base components (buttons, fields, segmented control, stamps, filter tabs, ledger sheet, dialogs, toast, banner, empty state, skeleton).
- F3 (done): app shell and responsive layout (bar, bottom nav, rail, side nav, two panes) with mock data.
- F4 (done and merged in PR #18): auth screens wired to the API. The sign-up form field order is Invite code, Account name, Email, Password, and it sends `invite_code` (M9).
  - F4 must proxy API calls through Next.js rewrites or route handlers (never call the Render API from the browser), forwarding cookies and `Origin`. The session cookie is first-party to the Vercel domain; `SameSite=None` to onrender.com was rejected (DECISIONS.md, M10).
  - The backend Origin check only helps when the browser's Origin reaches the API. If the frontend proxies through Next.js route handlers (server-side fetch), Origin is absent and SameSite=Lax is the actual CSRF protection; if it uses rewrites, verify that Origin, Sec-Fetch-Site and cookies are forwarded, and add a test for that. The deployed frontend origin must be in `ALLOWED_ORIGINS`.
  - Account screen: a delete-account flow. First modal states exactly what will be permanently deleted (the account, all applications, all interviews, all sessions) and that it cannot be undone. Second step requires typing the account email and the password; the final button stays disabled until the typed email matches. Calls `POST /account/delete`; 403 means wrong password (show it inline, do not log out), 401 means the session is gone.
  - Note for copy and tests: the account stays deleted even if the user later gets a new invite code; signing up again creates a fresh, empty account.
- F5 (done and merged in PR #19): application list (server-side status filter, Load more), detail (stale-while-revalidate, isolated interviews error), create and edit form, delete. Interviews are read-only on the detail.
- F6 (done and merged in PR #20): interviews create, edit and delete (full-screen routes, times in PHT only, no automatic status change), Add interview on the detail, shared `TextAction`.
- F8 (done, merged in PR #24): interviews agenda across applications (Upcoming / Past, PHT day groups, Load more), per-interview `.ics` download built in the browser, import guide; third nav destination; no migration.
- F9 (done and merged in PR #25): month calendar view of the Interviews screen (`GET /interviews/calendar`, grid, keyboard navigation, PHT only); no migration.
- F10 (done, merged in PR #29): follow-up list (`GET /applications?follow_up=true&days=`, Needs follow-up in the Status select); no migration.
- F7 (done, 2026-11-09): live on Vercel + Render + Neon (https://talaan-phi.vercel.app); results and gotchas in docs/DEPLOY.md.

## Admin

- A1 (done, 2026-11-21): admin page for invites at `/admin`. List invites; create one with a show-once code and a copy button; revoke an unused invite. Access is gated by `ADMIN_EMAILS`, no migration. Creating needs a password re-check, is rate limited and capped at 50 unused invites. It reversed the 2026-11-03 "no admin endpoint" rule (DECISIONS.md 2026-11-21, docs/AUTH.md).

Friend trial checklist:
- Invite 3 to 5 people, one code each. Create invites at `/admin` (note = the friend's name, 14 days); the CLI still works: `python -m app.admin create-invite --note "<name>" --expires-in 14d`.
- Ask for feedback after a week.
- Ask them to try add application, add interview, and Needs follow-up.

## Chrome extension

Order of work (S0 first; each later step is its own mergeable PR):
- ~~S0 spike (throwaway, nothing merged): can an MV3 extension popup call the API with the user's login cookie, what Origin and Sec-Fetch-Site headers arrive, what the origin check needs, a stable extension ID, logged-out behavior, and `activeTab` reads of the title, JSON-LD and Open Graph tags.~~ Done 2026-11-21: cookie-first works (confirmed in Brave on production); the origin check blocks every extension write until `EXTENSION_ORIGINS` allows a pinned ID. Findings: [docs/spikes/extension-cookie.md](spikes/extension-cookie.md); code stays on the unmerged branch `spike/extension-cookie`.
- E1 `job_url`: a nullable column on applications, an "Open posting" link, editable in the form, and "already saved" detection on a repeat capture; DESIGN.md update.
- E2 the extension: a popup with editable prefilled fields; generic extraction only (JSON-LD `JobPosting`, then Open Graph and the page title; no per-site scrapers, no AI); user-initiated, `activeTab` only, unpacked install first; lives in `extension/` with its own small build and unit tests on synthetic HTML fixtures; authenticates with the user's login cookie if S0 shows it works. Notes from S0: pin the extension ID with a `key` in the manifest, private key kept outside the repo; set `EXTENSION_ORIGINS` in Render; the first manual step is to verify `activeTab` and a real job page in Chrome (production was checked in Brave only).
- E3 personal API tokens: an Account screen (create, shown once, hashed, revoke, cap 5, rate limit, last used) and a quick-add endpoint that accepts only a token and can only create an application; the extension gets a "use a token" option.
- E4 phone share target and polish.

Decided: no AI in extraction (a fallback for pages with no structured data is deferred to v1.2, bring-your-own key). Chrome Web Store later (one-time fee, review). Desktop only (Chrome on Android has no extensions). See DECISIONS.md 2026-11-21.

## Clients

Talaan must be usable on desktop and mobile. The later Vercel frontend is responsive, mobile-first, installable as a PWA, with a share target ("Share to Talaan"). A native Flutter app is optional and not committed. Docs only for now; nothing is built.

## Backlog

- A1 follow-ups (2026-11-21): no user management (list, disable or delete accounts), no audit log of who created or revoked an invite, and an unpaginated invite list (add paging if it grows). Email verification is the way to close the `ADMIN_EMAILS` limit (an address with no account yet can be claimed by anyone holding a valid invite; docs/AUTH.md).
- NUL bytes (\x00) in free text give a 500 (found 2026-11-21): application `company`/`job_name` (`Name`, app/applications/schemas.py:20), `remarks` (`Remarks`, app/applications/schemas.py:24, also used by interviews), interview `interviewer` (app/interviews/schemas.py:20) and signup `account_name` (app/users/schemas.py:22, no constraints at all). Login `password` is not affected: measured 401 for both an existing and an unknown email. Postgres text cannot hold NUL; reject it in the schema like the invite note (422).
- Deploy note (2026-11-21): `ADMIN_EMAILS` must name an account that already exists (emails are not verified; DECISIONS.md 2026-11-21).
- `list-invites` (2026-11-21): the TSV output breaks when an invite note or an account name contains a tab or a newline; escape or strip them.
- CI `changes` job clones the full history (`fetch-depth: 0`) only to list changed paths. Deferred (2026-10-28): a full clone of this small repo costs seconds. Revisit if clone time grows (many binary design assets); `gh pr diff --name-only` or the `pulls/{n}/files` API needs no checkout.
- Playwright layout smoke tests in CI (clipping, 44px targets, no horizontal scroll). Reason (2026-11-02): layout can't be tested in jsdom; the F2a review checks (segment clipping at 320px, hover band) were run by hand in Chrome.
- The 88px rail fits the bold 14px label "Applications" only with `tracking-tight` (77px label in a 79px pill, 4px from the rail edges). A longer label or a third item needs a wider rail or a smaller label token. (2026-11-11, F8: the third item, "Interviews", fits; checked at 768 in `e2e-agenda.cjs`. A longer fourth label would still need the wider rail.)
- Add a formatter (Prettier) and a CI format check. Reason (2026-11-03): no formatter config exists, so JSX indentation drifted by hand in the F3 layouts (code review finding 9). Not added in F3 to keep the PR scoped; needs a dependency decision.
- Backend: `ruff format --check` fails on many pre-existing files. Add a formatter run (one `ruff format` commit) and a CI format check, same as the frontend formatter item. Found 2026-11-03 (PR #14); nothing reformatted yet.
- 2026-11-03: `npm audit` shows 16 moderate findings, all one minimatch advisory (GHSA-g3hv-75wg-m249) through the ESLint toolchain, dev-only (`npm audit --omit=dev` = 0). No non-breaking fix; do NOT run `npm audit fix --force` (it downgrades to eslint 4.0.0). Recheck when eslint-config-next or typescript-eslint is bumped, or via Dependabot.
- Measure queries held under the advisory lock on Neon at F7 (pooled vs direct connection string: see docs/DEPLOY.md). Deferred (2026-11-03, PR #14 review finding 4): a login runs about 8-10 statements inside the locked transaction (lock, prune, count, offset query, insert per key); at 5-20 ms per query on a remote DB, bursts behind one IP queue up. Merge into fewer statements only if the measurement says so.
- ~~**M11 BLOCKER (2026-11-03, F4): one shared client IP behind the Next rewrite.**~~ Done 2026-11-09 (M11): `proxy.ts` forwards the visitor IP with a shared secret; see DECISIONS.md 2026-11-09. Still to do at deploy: add the Vercel origin to `ALLOWED_ORIGINS`, set `BACKEND_URL` and `PROXY_SECRET` (docs/DEPLOY.md).
- ~~M11 (deploy): disable `/docs`, `/redoc` and `/openapi.json` in production.~~ Done 2026-11-09 (`ENVIRONMENT=production`).
- Optional origin lock (2026-11-09, M11): require the proxy secret on every `/api/v1` request so the Render URL only answers Vercel. Not needed for the rate limiter, because direct callers share one socket bucket and cannot affect Vercel users.
- Backend: one module that imports all models, used by `alembic/env.py`, `app.admin` and any future process entrypoint (a bare process missed `app.users.models` once). Found 2026-11-03 (M9): `python -m app.admin create-invite` crashed with `NoReferencedTableError` because only the tests import every model. `app/admin.py` now carries its own `import app.users.models`. Not built.
- F6 review item 8 (2026-11-09): `EditInterviewScreen` copies the application `EditScreen` (keyed load result, retry, "empty live region first" timer, AppBar + main + skeleton/not-found/error). Extract one shared edit loader in a small refactor PR so the two copies cannot drift (they already did once: the appId key, fixed in review item 4). Second review (PR #20, 2026-11-09, item 8): `NewInterviewScreen` (the new-interview route now loads the application before the form) is a third copy of the same loader; fold it in too.
- F6 review item 9 (2026-11-09): the "Interview not found." `NotFoundState` props and the form page wrapper (`AppBar` + `<main id="content" ... max-w-[640px] ...>`) repeat in 3-5 files. Extract an `InterviewNotFound` and a form page shell in the same small refactor PR. Second review (PR #20, 2026-11-09, item 10): the ?status= parsing is repeated in each page.tsx and the form page layout is copied 8 times; one `qsFromSearchParams` helper and the form page shell cover both.
- ~~F6 review item 10 (2026-11-09): the `DetailContext` value is a new object on every `ApplicationsScreen` render.~~ Done in the second review (PR #20, item 9): the context now holds `DetailState` directly, so no wrapper object is built per render.
- Frontend e2e scripts (2026-11-09, PR #20 review round 2): `scripts/e2e-*.cjs` do not close the browser when a step throws, so a failed run hangs after the teardown has already run (seen with `e2e-interviews.cjs`). Wrap each run in try/finally that closes the browser.
- DECISIONS.md (2026-11-09): the F6 entry (2026-11-04) has its last five bullets duplicated ("The backend's PATCH and DELETE are flat" through "Local scripts"). Remove the duplicate in a tiny docs commit; it is a copy error, not a rewrite of the decision.
- ~~Interview writes clear every cache (2026-11-09): `clearCaches()` also empties the list cache, so at 1280 the list pane briefly shows skeleton rows after an interview delete although the list is unchanged (seen in the F6 review e2e). Scope the clear for interview writes to the detail caches only.~~ Done in P1 (`clearDetail(id)`, DECISIONS.md 2026-11-09 P1).
- ~~Login "waking up" message (2026-11-09, F7): when the API takes more than about 3 seconds to answer, show that the server is waking up. A cold start was measured at 19 seconds (docs/DEPLOY.md section 5).~~ Done in P1 for login, sign-up and the first list or detail load. Not covered: the edit screens' fresh fetch and the Account `getMe`; add `WakingUp` there if they prove slow.
- No keep-alive ping that touches the database (2026-11-09, F7): it would burn Neon free compute hours. Check Neon's current free limits before adding any keep-alive; a ping to `/ping` (no DB) only wakes Render.
- Check Vercel usage once after the first week (2026-11-09, F7): see the last item of docs/DEPLOY.md section 4.
- PR #23 review item 8 (2026-11-10): Change status blocks a double submit four times (the `savingStatus` ref, `statusBusy`, the `if (!busy)` in StatusDialog's onSubmit, and aria-disabled controls). Since the busy controls use aria-disabled instead of `disabled`, the onSubmit check is the one that blocks Enter; the ref covers two clicks in one tick. Fold the rest into those two.
- `DeleteConfirm` (2026-11-10, PR #23 review): `busy` sets `disabled` on the focused confirm button, which drops focus to `<body>`; a failed delete leaves the open dialog with no focus. Use the StatusDialog approach (aria-disabled, focus back on failure).
- Waking-up line (2026-11-10): shown only before the first data in a tab. If the free-tier API sleeps again mid-session, a later slow reload gets no explanation. Accepted for now.
- PR #23 review round 3, finding 1 (2026-11-10): optimistic concurrency for PATCH, an `updated_at` precondition (409 on mismatch). A status PATCH the server saves after the client's 60 s timeout lands after the refetch, so the screen keeps the old status, and a retry can lose to the late save. Deferred: it needs a backend contract change; the client alone cannot close the window.
- PR #23 review round 3, finding 3 (2026-11-10): during a status PATCH refuse only the lists it can change (`all`, the old and the new status) instead of every list. Today an unrelated page 1 can sit on the skeleton for up to 60 s on a cold backend. Deferred: latency on cold starts only, never wrong data.
- PR #23 review round 3, finding 9 (2026-11-10): a per-id application stamp in `cache.ts`, bumped by `storeApplication`, to replace the three tokens that guard the application request in `use-detail.ts` (`cacheVersion`, `detailStamp`, a hook-local counter). Deferred: a refactor with no behavior change.
- Detail back arrow returns to the agenda when the application was opened from it (2026-11-11, F8). Left out: the browser Back button already returns to the agenda, and the arrow would need a query param on the detail route (like `?status=`) that every link to the detail has to carry.
- Import guide gaps (2026-11-11, F8): opening the `.ics` directly on an iPhone or an Android phone, and the new Outlook for Windows, are not in the guide because Apple's and Microsoft's help pages did not document them. Add them when a vendor page states the steps.
- PR #24 review round 1, finding 8 (2026-11-12): the `.ics` has no `SEQUENCE` or `LAST-MODIFIED`, so a file downloaded again after an edit carries the same UID at revision 0, and Apple Calendar or Outlook may keep the old time. Deferred: the guide already tells people to delete the old event first, and `SEQUENCE` needs a counter the schema does not have (`updated_at` as `LAST-MODIFIED` is the cheap half).
- PR #24 review round 1, finding 9 (2026-11-12): the detail decides "upcoming" (Add to calendar) with the device clock, the agenda with the server clock (`as_of`), so a skewed phone can disagree for a few minutes around an interview's start. Deferred: it only affects which interviews offer a file, never the data.
- PR #24 review round 1, finding 10 (2026-11-12): `use-agenda.ts` is a near copy of `use-list.ts` (announcement, focus, key/tick refetch, Load more with de-dup). Extract one paged-list hook taking a fetcher and the cache get/set/version functions. Deferred: a refactor touching the applications list, which has its own status-write window; the agenda copy now has its own tests (`tests/use-agenda.test.tsx`).
- Rate limits cover `/login`, `/signup` and account deletion (`/account/delete`), not other authenticated routes
- Backend: the agenda (`GET /interviews`), the calendar (`GET /interviews/calendar`) and the other authenticated routes have no rate limit (same backlog item as above).
- Status select known races from PR #31 review (2026-11-18, see DECISIONS.md): if a user sees the flicker, spike `useOptimistic` in a real browser first, and extract one shared `useUrlBacked` hook for the Status select and the two agenda `SegmentedControl`s.
- Neutral banner variant for non-error notices (2026-11-13, F9): the truncated-calendar banner uses the error style; it is only reachable above 200 interviews in a range.
- F9 (2026-11-12): a month with more than 200 interviews shows the first 200 and a banner, so a day's count can be low. Raise the cap or add a per-day count endpoint if it ever matters.
- F9 (2026-11-12): `use-calendar.ts` is a third near copy of the cache-version/refetch pattern (with `use-agenda.ts` and `use-list.ts`); fold into one hook in the same refactor as the agenda item above.
- F9 (2026-11-12): the month view computes "today" on each render and does not re-render at midnight PHT; the outline moves on the next interaction. Accepted.
- PR #25 review, finding 8 (2026-11-15): the calendar range cache in `cache.ts` keeps one entry per month visited for the life of the tab. Deferred: entries are bounded by hand navigation, and every write and auth event clears them.
- PR #25 review 2, finding 3b (2026-11-15): pressing Today on the current month moves the selected day to today without any announcement. Whether selection changes are announced is a design decision, so it is not changed here.
- PR #25 review 2, finding 4 (2026-11-15): the real-day check exists three times, in `calendar.ts` (`isDay`, `toDate`/`toDay`, `phtToday`), `format.ts` (`DATE_ONLY` plus `onCalendar`) and `pht.ts` (the PHT offset and `pad`). The behavior is identical today. Refactor to one helper after F9 ships.
- PR #25 review 2, finding 8 (2026-11-15): `month-view.tsx` imports `ANNOUNCE_MS` from the applications screen's `(ledger)/use-list`, as `use-agenda.ts` has done since F8. Move it to `src/lib/` in the use-agenda/use-list merge (the backlog item for PR #24 finding 10).
- PR #25 review 3, finding 4 (2026-11-16): a Next click followed by PageDown (or an arrow past the grid) inside one URL commit ends one month short. The keyboard path starts from the grid's own focused day, not from the page's `asked` queue, so the two presses do not add up. Deferred: the window is a few milliseconds.
- ~~`scripts/local-env.cjs` (2026-11-16): the e2e scripts start `next dev` on :3000 when it is free, which then collides with a later local `npm run dev`. Add an `E2E_WEB_PORT` override like `E2E_API_PORT`.~~ Done 2026-11-16: `E2E_WEB_PORT` (default 3000), like `E2E_API_PORT`.
- No-store middleware matches the prefix `/api/v1`, so a future `/api/v10` would match too; use `/api/v1/`
- Signup reveals whether an email exists ("Email already exists"), but only to holders of a valid invite code (M9); email verification is the full fix
- Stale stub docstrings in `app/` reference the old learning-mode rules and passlib; clean up.
- Google OAuth signup: needs nullable `password_hash` + `auth_provider`/`google_id`
  (or an `oauth_identities` table) and a rule for email collisions with local accounts
- `/signup` returns 400/200 where API.md says 409/201; tests in `tests/auth/test_signup.py`
  assert the current behavior and must change when aligned
- `/signup` check-then-insert race: concurrent duplicate hits the unique constraint (500); catch `IntegrityError`
- Successful logins count against the per-IP limit; a shared IP (campus, office) can hit it (accepted, DECISIONS.md 2026-11-03)
- Tests: starlette warns `httpx` is deprecated for `TestClient` (suggests `httpx2`); revisit
- Manually exercise the app end-to-end (2026-11-16, moved from the CLAUDE.md status list): walk through `/docs`, a curl cookie jar and psql against a local stack; the only open item of the old checklist.
- Model docstrings (2026-11-16): `app/applications/models.py`, `app/interviews/models.py`, `app/auth/models.py` and `app/users/models.py` say "See the ... table in CLAUDE.md for the column spec", but the tables now live in the Schema section of docs/ARCHITECTURE.md; `app/auth/router.py`, `app/auth/schemas.py`, `app/auth/security.py` and `app/users/schemas.py` still cite "CLAUDE.md rule 2" from the learning-mode agreement. Fix them together with the stale-docstrings item above; not changed here because this PR is docs-only.
- Script headers (2026-11-16): `e2e-calendar.cjs:6` (and any other header with the same wording; grep for "/ :3000") says a foreign ":8000 / :3000" process is checked, but `local-env.cjs` checks only :8000; fix the wording when those files are next touched.
- Interviews screen (2026-11-18): the View (Agenda/Month) and Show (Upcoming/Past) `SegmentedControl`s (`frontend/src/app/(app)/interviews/agenda-screen.tsx`, lines 57 and 95) are controlled by the URL like the Status select was, so a second arrow key before `router.replace` lands starts from the old value (two fast arrows from Upcoming end on Past, not Upcoming). Low severity (two options). Fix in its own small PR, with the rule in DECISIONS.md (2026-11-18).
- Backend (2026-11-17): the applications and interviews routers each define `_now()`, `_bad()` and a differently signed `_pht_day`. Fold them into shared helpers when a third router needs them.
- Backend (2026-11-17): the follow-up query repeats the correlated `max(scheduled_at)` subquery. Revisit if lists reach thousands of rows.
- F10 (2026-11-17): the follow-up threshold is fixed at 7 days in the UI; the API already takes `days` (1 to 90). A setting is deferred.
- F10 (2026-11-17): no "mark as followed up". It needs a new column, so it is not built.
- F10 (2026-11-17): no reminders, notifications or emails; the view only lists rows when it is opened.
- `local-env.cjs` (2026-11-16): a cleanup error (for example `truncateAll` failing in the finally) can hide the original error; the exit code is still 1; low priority.
- `local-env.cjs` (2026-11-18): on a cold start the e2e scripts sometimes report "next dev did not come up" or a signup timeout and pass on retry; consider a longer or readiness-based wait.
- `eslint-config-next` (2026-11-18): still 16.4.3 while `next` is 16.4.6; align the two (separate change, dev-only).
- `docs/FRONTEND.md` (2026-11-18): line 20 says chromium build 1243 wants Playwright 1.63.0, but the F9 entry in DECISIONS.md records 1.64.1 working with 1243 (confirmed again for the next 16.4.6 bump); fix the line. Also document the values used for the local e2e scripts: `NODE_PATH=~/.npm/_npx/e41f203b7505f1fb/node_modules`, `PW_CHROMIUM=~/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`.

## Maintenance

Update **Current milestone** at the start and end of each milestone. The only edit to the original roadmap text is the `saved` status item in v1a (see DECISIONS.md, 2026-10-20).
