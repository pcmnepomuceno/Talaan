# Job Application Tracker

Project 1 of a 30-day backend + AI/ML learning roadmap. This is a personal
job-application tracker: a user logs the companies/roles they've applied to,
tracks status changes, and records interview rounds.

The goal of this project is depth of understanding over speed of delivery —
see "Working Agreement" below before generating anything.

## Stack

- **Backend:** FastAPI (Python)
- **Database:** PostgreSQL
- **Local dev:** Docker (Postgres container at minimum; full docker-compose once the API is dockerized too)
- **Password hashing:** `bcrypt` (direct — `passlib` was dropped, unmaintained and broken against `bcrypt` 5.x)

## Schema

### Users
| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| email | string | UNIQUE |
| password_hash | string | never store a raw/plaintext password |
| account_name | string | |

### Sessions
| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| token | string | UNIQUE — the value stored in the `session_token` HttpOnly cookie |
| user_id | integer | foreign key → Users.id |
| created_at | timestamp | `DateTime(timezone=True)` — plain `DateTime` silently drops tz info from Postgres |
| expires_at | timestamp | `DateTime(timezone=True)`; session lifetime currently `timedelta(weeks=4)` — placeholder, not a deliberate choice yet |

### Job Applications
| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| company | string | |
| job_name | string | |
| contact_website | string | nullable |
| contact_email | string | nullable |
| status | ENUM | applied, interview, accepted, denied, etc. |
| salary | integer | nullable |
| mode_of_work | ENUM | on-site, wfh, async, etc. |
| remarks | string | free-text notes |
| date_applied | timestamp | when the application actually happened |
| created_at | timestamp | when the row was created |
| updated_at | timestamp | last edited |
| created_by | integer | foreign key → Users.id |

**Needs a double-check:** current model file is a pre-Day-3 placeholder stub — verify it still matches this spec before building schemas/routes against it.

### Interviews
| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| job_application_id | integer | foreign key → Job Applications.id |
| interviewer | string | |
| datetime | timestamp | |
| mode | ENUM | on-site, online, async |
| outcome | ENUM | good, bad, pending, etc. |
| remarks | string | free-text notes |

**Needs a double-check:** same as Job Applications — pre-Day-3 placeholder stub.

Relationships: Users 1—N Job Applications 1—N Interviews. Users 1—N Sessions.
Each foreign key lives on the "many" side only — no relationship is ever
duplicated on both sides (e.g. Users does NOT store a list of its
applications; query by `created_by` instead).

## Auth design decisions

- **Sessions over JWT** — chosen specifically for instant revocation (delete
  the row, access is gone immediately), since this is a solo project where
  JWT's horizontal-scaling advantage doesn't apply.
- **Password rules** (`UserCreate` schema): 8–72 bytes, checked as UTF-8 byte
  length (not character count — bcrypt has a 72-byte input limit), plus
  upper/lower/digit/special-char requirements. Complexity rules apply only at
  signup (`UserCreate`), not at login (`UserLogin`).
- **Login error responses:** wrong password and nonexistent email both return
  `401`, never `404` — a `404` would let an attacker enumerate which emails
  are registered.
- **`get_current_user` dependency** (`app/dependencies.py`): reads the
  `session_token` cookie, looks up the Session row, rejects (401) if missing,
  rejects + deletes the row if `expires_at` has passed (opportunistic
  cleanup), otherwise resolves and returns the `User`. Verified against a
  real Postgres container for valid/expired/bogus tokens.

## Working Agreement — read this before generating any code

I am using this project to relearn backend fundamentals properly, not to
collect a finished repo I can't explain. Follow these rules strictly:

1. **Boilerplate and scaffolding only, unless told otherwise.** Project
   structure, folder layout, `requirements.txt`, `docker-compose.yml`,
   `.env.example`, dependency setup — generate freely.
2. **Never write route logic, auth, validation, or business rules for me.**
   If I ask for one of these, explain the concept and the approach instead
   of producing the finished code. If I explicitly say "let's do
   explain → attempt → hint → review," follow that sequence: explain the
   concept, wait for my attempt, give hints (not solutions) if I'm stuck,
   review what I wrote, suggest improvements — don't rewrite it wholesale.
3. **Don't assume I understand something just because it runs.** If I
   accept a change without being able to explain why it works, flag that
   explicitly rather than moving on.
4. **When scaffolding, leave clearly marked stubs** (e.g. `# TODO: implement`)
   for anything that falls under rule 2, rather than filling them in
   "temporarily."
5. Keep secrets out of version control — real config goes in `.env`
   (gitignored), only `.env.example` with placeholders is committed.

### How I want you to work with me

Five roles, named explicitly when I need one specifically: **teacher**
(explain a concept before I touch code), **pair programmer** (nudge while
I'm actively writing), **reviewer** (assess what I actually wrote, not what
you'd have written), **interviewer** (cold questions, no notes), **mentor**
(zoom out — do I actually understand this, or did it just run).

For anything under rule 2, follow **explain → attempt → hint → review →
improve**: explain the concept with no code, I attempt it myself, you hint
rather than fix if I'm stuck, we review it together line by line, I make the
edits. Above all: if I accept something without being able to explain why it
works, stop and say so — even if I seem satisfied and want to move on.

## Backlog (explicitly deferred, not started)

- **Google OAuth signup** — needs `password_hash` nullable +
  `auth_provider`/`google_id` columns (or a separate `oauth_identities`
  table), plus a decision on what happens when a Google email collides with
  an existing local account.

## Current status

- [x] Data model designed (Users / Sessions / Job Applications / Interviews)
- [x] Project skeleton scaffolded
- [x] Postgres running via Docker
- [x] `/health` route (written by hand) — currently a bare `{"status": "ok"}`, does not check the DB connection
- [x] `Users` and `Sessions` SQLAlchemy models
- [x] `POST /signup`, `POST /login`, `POST /logout` (`app/routes/auth.py`) — implemented and verified against real Postgres
- [x] `get_current_user` auth dependency (`app/dependencies.py`) — implemented and verified, valid/expired/bogus tokens all behave correctly
- [ ] Wire `Depends(get_current_user)` into an actual protected route — dependency exists but nothing uses it yet
- [ ] `/health` checks the DB connection, not just that the process is up
- [ ] Deliberately choose (and justify) session lifetime — currently an unexamined `timedelta(weeks=4)` placeholder
- [ ] Verify `JobApplication`/`Interview` models still match the schema above
- [ ] Schemas + CRUD routes for Job Applications and Interviews