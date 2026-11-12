# Talaan Roadmap

**Current milestone:** F9 calendar view (on `feature/f9-calendar`): `GET /interviews/calendar` (PHT date range, ascending, capped at 200), a Month view on the Interviews screen (`?view=month&month=YYYY-MM&day=YYYY-MM-DD`), keyboard date grid, DESIGN.md v2.5. F8 (agenda, `.ics`, import guide) is merged. Not in this batch: drag to reschedule, adding an interview from a day, week or day views, application dates in the grid, subscription feed, API tokens, a duration field, swipe actions, demo account, README screenshots.

## Roadmap

Committed:
- v1a core tracker: auth fixes + tests; domain layout move; applications CRUD with status filter + pagination; `saved` application status + nullable `date_applied` (new migration); interviews; per-user isolation; real /health with a DB check; Docker; CI.
- v1b multi-user hardening, then DEPLOY: invite-code signup via env var behind a swappable check_signup_allowed(); rate limiting on login/signup; account deletion (sessions.user_id ON DELETE CASCADE migration + delete-account endpoint); hashed session tokens (token -> token_hash migration); SameSite=Lax and Secure via config; deploy to Render + Neon. Ship here before v1c.
- v1c Filipino job-seeker features: interview export as .ics plus an "Add to Google Calendar" link (no OAuth); follow-up list (applied N days ago, no update); documents checklist per application (NBI, TIN, SSS, PhilHealth, Pag-IBIG, TOR, diploma); rule-based scam red-flag check (asks for fees, personal-email domain, no company details).
- v1.1: hashed personal API tokens + browser extension (desktop capture path: user-initiated capture of the page the user is viewing); PWA share target and quick-add (mobile capture path); scam checks on captured jobs.

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
- F4 (done, in review on `feature/f4-auth`): auth screens wired to the API. The sign-up form field order is Invite code, Account name, Email, Password, and it sends `invite_code` (M9).
  - F4 must proxy API calls through Next.js rewrites or route handlers (never call the Render API from the browser), forwarding cookies and `Origin`. The session cookie is first-party to the Vercel domain; `SameSite=None` to onrender.com was rejected (DECISIONS.md, M10).
  - The backend Origin check only helps when the browser's Origin reaches the API. If the frontend proxies through Next.js route handlers (server-side fetch), Origin is absent and SameSite=Lax is the actual CSRF protection; if it uses rewrites, verify that Origin, Sec-Fetch-Site and cookies are forwarded, and add a test for that. The deployed frontend origin must be in `ALLOWED_ORIGINS`.
  - Account screen: a delete-account flow. First modal states exactly what will be permanently deleted (the account, all applications, all interviews, all sessions) and that it cannot be undone. Second step requires typing the account email and the password; the final button stays disabled until the typed email matches. Calls `POST /account/delete`; 403 means wrong password (show it inline, do not log out), 401 means the session is gone.
  - Note for copy and tests: the account stays deleted even if the user later gets a new invite code; signing up again creates a fresh, empty account.
- F5 (done, in review on `feature/f5-applications`): application list (server-side status filter, Load more), detail (stale-while-revalidate, isolated interviews error), create and edit form, delete. Interviews are read-only on the detail.
- F6 (done, in review on `feature/f6-interviews`): interviews create, edit and delete (full-screen routes, times in PHT only, no automatic status change), Add interview on the detail, shared `TextAction`.
- F8 (done, merged in PR #24): interviews agenda across applications (Upcoming / Past, PHT day groups, Load more), per-interview `.ics` download built in the browser, import guide; third nav destination; no migration.
- F9 (done, in review on `feature/f9-calendar`): month calendar view of the Interviews screen (`GET /interviews/calendar`, grid, keyboard navigation, PHT only); no migration.
- F7 (done, 2026-11-09): live on Vercel + Render + Neon (https://talaan-phi.vercel.app); results and gotchas in docs/DEPLOY.md.

## Clients

Talaan must be usable on desktop and mobile. The later Vercel frontend is responsive, mobile-first, installable as a PWA, with a share target ("Share to Talaan"). A native Flutter app is optional and not committed. Docs only for now; nothing is built.

## Backlog

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
- `scripts/e2e-auth.cjs` (2026-11-10): start its stack through `local-env.cjs` like the other e2e scripts (free ports, `_test` database, teardown with proof the dev database was untouched), and fix its header and any docs that mention `test-env.sh`, which does not exist.
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
- Backend: the agenda (`GET /interviews`), the calendar (`GET /interviews/calendar`) and the other authenticated routes have no rate limit (same backlog item as above).
- F9 (2026-11-12): a month with more than 200 interviews shows the first 200 and a banner, so a day's count can be low. Raise the cap or add a per-day count endpoint if it ever matters.
- F9 (2026-11-12): `use-calendar.ts` is a third near copy of the cache-version/refetch pattern (with `use-agenda.ts` and `use-list.ts`); fold into one hook in the same refactor as the agenda item above.
- F9 (2026-11-12): the month view computes "today" on each render and does not re-render at midnight PHT; the outline moves on the next interaction. Accepted.

## Maintenance

Update **Current milestone** at the start and end of each milestone. The only edit to the original roadmap text is the `saved` status item in v1a (see DECISIONS.md, 2026-10-20).
