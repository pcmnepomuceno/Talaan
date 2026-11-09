# Talaan Roadmap

**Current milestone:** Frontend F6 (interviews: create, edit, delete in Philippine time, Add interview on the detail) built on `feature/f6-interviews`, in review. F1 to F5 merged. Next: F7 Vercel deploy. Backend: Milestone 4 done (interviews CRUD, `no-store` middleware for `/api/v1`, `Interview.updated_at` clock fix). CI added (GitHub Actions). Docker done (Dockerfile, `api` compose service). v1b: hashed session tokens done; M8 (login/signup rate limiting in Postgres, login timing fix) built on `feature/auth-rate-limit`, in review. M9 merged (invite-code signup: hashed single-use codes, `python -m app.admin` CLI; PR #15). M10 done on `feature/account-deletion` (account deletion, cookie flags, Origin check; in review). Next: M11 deploy. **M11 blocker:** purge `rate_limit_events` and expired `sessions` (pruning is per key only, so rows for keys that never return stay). The duplicate-email leak is only limited (rate limit now, invite code in M9); email verification is the full fix, planned later.

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
- F7 (next): Vercel deploy.

## Clients

Talaan must be usable on desktop and mobile. The later Vercel frontend is responsive, mobile-first, installable as a PWA, with a share target ("Share to Talaan"). A native Flutter app is optional and not committed. Docs only for now; nothing is built.

## Backlog

- CI `changes` job clones the full history (`fetch-depth: 0`) only to list changed paths. Deferred (2026-10-28): a full clone of this small repo costs seconds. Revisit if clone time grows (many binary design assets); `gh pr diff --name-only` or the `pulls/{n}/files` API needs no checkout.
- Playwright layout smoke tests in CI (clipping, 44px targets, no horizontal scroll). Reason (2026-11-02): layout can't be tested in jsdom; the F2a review checks (segment clipping at 320px, hover band) were run by hand in Chrome.
- The 88px rail fits the bold 14px label "Applications" only with `tracking-tight` (77px label in a 79px pill, 4px from the rail edges). A longer label or a third item needs a wider rail or a smaller label token.
- Add a formatter (Prettier) and a CI format check. Reason (2026-11-03): no formatter config exists, so JSX indentation drifted by hand in the F3 layouts (code review finding 9). Not added in F3 to keep the PR scoped; needs a dependency decision.
- Backend: `ruff format --check` fails on many pre-existing files. Add a formatter run (one `ruff format` commit) and a CI format check, same as the frontend formatter item. Found 2026-11-03 (PR #14); nothing reformatted yet.
- 2026-11-03: `npm audit` shows 16 moderate findings, all one minimatch advisory (GHSA-g3hv-75wg-m249) through the ESLint toolchain, dev-only (`npm audit --omit=dev` = 0). No non-breaking fix; do NOT run `npm audit fix --force` (it downgrades to eslint 4.0.0). Recheck when eslint-config-next or typescript-eslint is bumped, or via Dependabot.
- Measure queries held under the advisory lock on Neon at M11. Deferred (2026-11-03, PR #14 review finding 4): a login runs about 8-10 statements inside the locked transaction (lock, prune, count, offset query, insert per key); at 5-20 ms per query on a remote DB, bursts behind one IP queue up. Merge into fewer statements only if the measurement says so.
- **M11 BLOCKER (2026-11-03, F4): one shared client IP behind the Next rewrite.** The browser reaches the API only through Vercel's `/api/*` rewrite, so the backend sees Vercel as the socket peer: every user looks like ONE IP. Risk: a single attacker can burn the per-IP login (10 per 15 min) and signup (5 per hour) limits and lock everyone out of login for 15 minutes. Local capture with an echo backend (F4) showed Next forwards `Origin`, `Sec-Fetch-Site`, `Referer`, `Cookie` and `X-Forwarded-Host` but NO `X-Forwarded-For`, so `TRUST_PROXY=true` would not help locally. Decision to take AFTER a real header capture on Vercel + Render (log the headers the API receives on one request): (a) `proxy.ts` performs the `/api` rewrite itself and adds a client-IP header plus a shared secret that the backend trusts only when the secret matches (needs a backend change); (b) relax the per-IP login limits in production and rely on the per-email limit and the invite gate; (c) another hosting arrangement that preserves the client IP. No backend change was made in F4. Also: add the Vercel origin to `ALLOWED_ORIGINS`, and set `BACKEND_URL` in the Vercel project.
- M11 (deploy): disable `/docs`, `/redoc` and `/openapi.json` in production behind an env switch (FastAPI `docs_url`/`redoc_url`/`openapi_url=None`). Reason (2026-11-03, PR #17 review): the Origin check now trusts `Sec-Fetch-Site: same-origin`, so Swagger can call every write route; public API docs are not needed in production.
- Backend: one module that imports all models, used by `alembic/env.py`, `app.admin` and any future process entrypoint (a bare process missed `app.users.models` once). Found 2026-11-03 (M9): `python -m app.admin create-invite` crashed with `NoReferencedTableError` because only the tests import every model. `app/admin.py` now carries its own `import app.users.models`. Not built.
- F6 review item 8 (2026-11-09): `EditInterviewScreen` copies the application `EditScreen` (keyed load result, retry, "empty live region first" timer, AppBar + main + skeleton/not-found/error). Extract one shared edit loader in a small refactor PR so the two copies cannot drift (they already did once: the appId key, fixed in review item 4).
- F6 review item 9 (2026-11-09): the "Interview not found." `NotFoundState` props and the form page wrapper (`AppBar` + `<main id="content" ... max-w-[640px] ...>`) repeat in 3-5 files. Extract an `InterviewNotFound` and a form page shell in the same small refactor PR.
- F6 review item 10 (2026-11-09): the `DetailContext` value is a new object on every `ApplicationsScreen` render, so the detail pane re-renders on list-only updates. Memoize it only if profiling shows a measurable cost.
- DECISIONS.md (2026-11-09): the F6 entry (2026-11-04) has its last five bullets duplicated ("The backend's PATCH and DELETE are flat" through "Local scripts"). Remove the duplicate in a tiny docs commit; it is a copy error, not a rewrite of the decision.

## Maintenance

Update **Current milestone** at the start and end of each milestone. The only edit to the original roadmap text is the `saved` status item in v1a (see DECISIONS.md, 2026-10-20).
