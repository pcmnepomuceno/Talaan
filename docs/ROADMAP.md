# Talaan Roadmap

**Current milestone:** Milestone 2 done (domain layout, `/api/v1` prefix, real `/health` + `/ping`). Next: applications CRUD, including the `saved` status + nullable `date_applied` migration.

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

## Clients

Talaan must be usable on desktop and mobile. The later Vercel frontend is responsive, mobile-first, installable as a PWA, with a share target ("Share to Talaan"). A native Flutter app is optional and not committed. Docs only for now; nothing is built.

## Maintenance

Update **Current milestone** at the start and end of each milestone. The only edit to the original roadmap text is the `saved` status item in v1a (see DECISIONS.md, 2026-10-20).
