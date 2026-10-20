# Talaan: Project Brief

Talaan (Tagalog for "record" or "list") is a job-application tracker for Filipino job seekers.

## Problem

Job seekers in the Philippines often track applications across Messenger threads, email, screenshots and ad-hoc spreadsheets. Following up, remembering which company said what, and preparing for interviews all suffer. Talaan keeps one record per application and one per interview round.

## Audience

- Filipino job seekers, including fresh graduates and career shifters.
- Friends and family first: the first users are 3 to 5 people I know, who give direct feedback.
- A portfolio piece: the code, docs and decisions should be readable by a reviewer.

## Clients

Talaan must be usable on desktop and mobile. The API comes first. The later frontend (hosted on Vercel) is responsive, mobile-first, installable as a PWA, and offers a share target ("Share to Talaan") so a job post can be saved from any app. A native Flutter app is optional and not committed. Nothing client-side is built yet.

## MVP

- Sign up, log in, log out (cookie sessions).
- Job applications: create, read, update, delete, with a status filter and pagination.
- Interviews per application (round, time, mode, outcome, remarks).
- Per-user isolation: a user can only see and change their own data.

## Out of scope for now

- Frontend.
- Statistics and dashboards.
- Status history (only the current status is stored).
- OAuth / Google sign-in.
- Email reminders.

Later features are listed in [ROADMAP.md](ROADMAP.md).

## Success criteria

- 3 to 5 friends use it for their real job search.
- A new user can save a job and see it in their list in under a minute, on a phone.
- No user can read another user's data (covered by tests).

## Constraints

- Free-tier hosting (Render + Neon), so cold starts are expected. See [ARCHITECTURE.md](ARCHITECTURE.md).
- Low-stakes data, but still treated carefully: hashed passwords, HttpOnly cookies, no secrets in git.
- Salary is monthly gross in PHP.
- The Claude Code login is not an API key and must never be used to power the app.

## Related docs

[ARCHITECTURE.md](ARCHITECTURE.md), [API.md](API.md), [ROADMAP.md](ROADMAP.md), [../DECISIONS.md](../DECISIONS.md).
