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

## Schema

### Users
| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| email | string | UNIQUE |
| password_hash | string | never store a raw/plaintext password |
| account_name | string | |

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

### Sessions
| Column | Type | Notes |
|---|---|---|
| id | integer | primary key |
| session_token | string | UNIQUE, the actual random token stored in the user's cookie |
| user_id | integer | foreign key → Users.id |
| created_at | timestamp | |
| expires_at | timestamp | when this session stops being valid |

Relationships: Users 1—N Job Applications 1—N Interviews, and Users 1—N
Sessions. Each foreign key lives on the "many" side only — no relationship
is ever duplicated on both sides (e.g. Users does NOT store a list of its
applications; query by `created_by` instead).

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

## Current status

- [x] Data model designed (Users / Job Applications / Interviews / Sessions)
- [x] Project skeleton scaffolded
- [ ] Postgres running via Docker
- [x] `/health` route (written by hand, not generated)
- [ ] `POST /signup`, `POST /login`, `POST /logout` (in progress — see auth
      route/schema/model stubs)

## Backlog (not started, deliberately deferred)

- **Alternative signup via Google OAuth.** Requires `password_hash` to
  become nullable on Users, plus a way to identify Google-originated
  accounts — either `auth_provider`/`google_id` columns on Users, or a
  separate `oauth_identities` table if multiple providers ever get added.
  Also needs a decision on what happens if a Google sign-in email matches
  an existing local-password account (link vs. reject vs. treat as
  separate users). Deferred because it's purely additive to the current
  schema — safe to build whenever it's actually needed.