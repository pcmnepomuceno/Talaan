# Talaan Roadmap

**Current milestone:** Frontend F3 (app shell, responsive layout, mock screens) in review; F2a and F2b merged. Backend: Milestone 4 done (interviews CRUD, `no-store` middleware for `/api/v1`, `Interview.updated_at` clock fix). CI added (GitHub Actions). Docker done (Dockerfile, `api` compose service). v1b: hashed session tokens done; M8 (login/signup rate limiting in Postgres, login timing fix) built on `feature/auth-rate-limit`, in review. M9 merged (invite-code signup: hashed single-use codes, `python -m app.admin` CLI; PR #15). Next: M10 account deletion and cookie flags, then M11 deploy. **M11 blocker:** purge `rate_limit_events` and expired `sessions` (pruning is per key only, so rows for keys that never return stay). The duplicate-email leak is only limited (rate limit now, invite code in M9); email verification is the full fix, planned later.

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
- F3 (done, in review): app shell and responsive layout (bar, bottom nav, rail, side nav, two panes) with mock data.
- F4: auth screens wired to the API. The sign-up form field order is Invite code, Account name, Email, Password, and it sends `invite_code` (M9).
- F5: application list, detail and forms.
- F6: interviews.
- F7: Vercel deploy.

## Clients

Talaan must be usable on desktop and mobile. The later Vercel frontend is responsive, mobile-first, installable as a PWA, with a share target ("Share to Talaan"). A native Flutter app is optional and not committed. Docs only for now; nothing is built.

## Backlog

- CI `changes` job clones the full history (`fetch-depth: 0`) only to list changed paths. Deferred (2026-10-28): a full clone of this small repo costs seconds. Revisit if clone time grows (many binary design assets); `gh pr diff --name-only` or the `pulls/{n}/files` API needs no checkout.
- `LedgerSkeleton` mounts its `role="status"` region together with its "Loading applications" text, so many screen readers do not announce it (code review finding, 2026-11-02). Deferred (2026-11-02): pages get a persistent loading live region in F5.
- Playwright layout smoke tests in CI (clipping, 44px targets, no horizontal scroll). Reason (2026-11-02): layout can't be tested in jsdom; the F2a review checks (segment clipping at 320px, hover band) were run by hand in Chrome.
- An unknown application id renders a client-side not-found view (HTTP 200). F5 decides whether the server should return 404.
- F5 requirement (2026-11-03): when `getApplication` and `getInterviews` become real fetches, a 404 on the application maps to the not-found state, not "Couldn't load this application."; a failed interviews fetch alone must not hide the application (show it with an inline interviews error and Retry). F3 mock behaviour differs: any rejection, including interviews, shows the whole-detail error.
- F5 requirement (2026-11-03, code review): stale detail. `screen.tsx` renders the cached detail at once when `detail.id === id` while the effect refetches, so after an edit (or any change elsewhere) it shows old fields and keeps Edit/Delete enabled on them. When the edit form and real fetches arrive, decide stale-while-revalidate (show the cache, Edit/Delete disabled until the refetch lands) vs a skeleton, and add a test for the chosen behaviour.
- F5 requirement (2026-11-03, code review): double list fetch. A filter with no matches makes a second, sequential full-list request just to learn the overall total, which costs an extra round trip against the real API. Take the total from the API response or a cached count. A failure getting the total must never turn an already loaded list into "Couldn't load applications."
- Detail has no "Add interview" action until F6. The 88px rail fits the bold 14px label "Applications" only with `tracking-tight` (77px label in a 79px pill, 4px from the rail edges). A longer label or a third item needs a wider rail or a smaller label token.
- Add a formatter (Prettier) and a CI format check. Reason (2026-11-03): no formatter config exists, so JSX indentation drifted by hand in the F3 layouts (code review finding 9). Not added in F3 to keep the PR scoped; needs a dependency decision.
- Backend: `ruff format --check` fails on many pre-existing files. Add a formatter run (one `ruff format` commit) and a CI format check, same as the frontend formatter item. Found 2026-11-03 (PR #14); nothing reformatted yet.
- 2026-11-03: `npm audit` shows 16 moderate findings, all one minimatch advisory (GHSA-g3hv-75wg-m249) through the ESLint toolchain, dev-only (`npm audit --omit=dev` = 0). No non-breaking fix; do NOT run `npm audit fix --force` (it downgrades to eslint 4.0.0). Recheck when eslint-config-next or typescript-eslint is bumped, or via Dependabot.
- Measure queries held under the advisory lock on Neon at M11. Deferred (2026-11-03, PR #14 review finding 4): a login runs about 8-10 statements inside the locked transaction (lock, prune, count, offset query, insert per key); at 5-20 ms per query on a remote DB, bursts behind one IP queue up. Merge into fewer statements only if the measurement says so.
- Backend: one module that imports all models, used by `alembic/env.py`, `app.admin` and any future process entrypoint (a bare process missed `app.users.models` once). Found 2026-11-03 (M9): `python -m app.admin create-invite` crashed with `NoReferencedTableError` because only the tests import every model. `app/admin.py` now carries its own `import app.users.models`. Not built.

## Maintenance

Update **Current milestone** at the start and end of each milestone. The only edit to the original roadmap text is the `saved` status item in v1a (see DECISIONS.md, 2026-10-20).
