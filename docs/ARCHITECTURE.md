# Talaan: Architecture

## Stack
FastAPI, sync SQLAlchemy, PostgreSQL 16, Alembic, bcrypt. Sync routes only (see CLAUDE.md conventions).

## Domain layout (planned)
Done as a move-only commit after the auth tests, before any CRUD.

```
app/main.py, config.py, database.py
app/auth/          router, schemas, models [Session], dependencies, security
app/users/         router, schemas, models
app/applications/  router, schemas, models, service, dependencies
app/interviews/    router, schemas, models, service
tests/             mirrors app/
```

## ERD
```mermaid
erDiagram
    USERS ||--o{ SESSIONS : has
    USERS ||--o{ JOB_APPLICATIONS : owns
    JOB_APPLICATIONS ||--o{ INTERVIEWS : has
    USERS { int id PK string email UK string password_hash string account_name }
    SESSIONS { int id PK string token UK int user_id FK timestamptz created_at timestamptz expires_at }
    JOB_APPLICATIONS { int id PK int created_by FK string company string job_name enum status enum mode_of_work int salary date date_applied }
    INTERVIEWS { int id PK int job_application_id FK timestamptz scheduled_at enum mode enum outcome }
```
Columns are abridged; the full schema is in CLAUDE.md.

## Sessions vs OWASP Session Management
Matches:
- Random, unguessable token (`secrets`), stored server-side.
- `HttpOnly` cookie; logout and expiry delete the row (instant revocation).
- Same 401 for unknown email and wrong password.

Planned (v1b): hash tokens at rest, `Secure` and `SameSite=Lax` via config, rate limiting on login/signup.

Deliberate deviations:
- **30-day absolute lifetime**, no idle timeout, no sliding renewal. Data is low-stakes; convenience wins (DECISIONS.md).
- **No token rotation at login-time privilege change**: there are no roles.
- Login currently returns the token in the JSON body; to be removed (backlog).

## Testing
- Separate `*_test` database. A guard aborts if the configured DB name does not end in `_test`.
- Schema built once per run with `alembic upgrade head` (tests the migrations too).
- Each test runs in a connection-level transaction with a savepoint, rolled back at the end.
- `pytest` + `httpx` against the FastAPI app.

## Deploy topology
- Render free web service (Docker) + Neon free Postgres.
- App uses the Neon **pooled** URL; migrations use the **direct** URL. `pool_pre_ping=True` survives dropped connections.
- Container entrypoint runs `alembic upgrade head`, then `exec uvicorn ... --proxy-headers` (so signals reach uvicorn and client IPs are right behind Render's proxy).
- `.dockerignore` excludes `.env`; secrets are Render env vars.
- Cold starts: free instances sleep. A cheap `/ping` (no DB) lets a free uptime pinger keep it warm. The frontend must show a loading state while the API wakes.

## Future frontend
Vercel hosts the PWA. `vercel.json` rewrites `/api/*` to Render, so the browser sees one origin and cookies stay first-party.

## Caching
Authenticated responses send `Cache-Control: no-store`.

## CI
GitHub Actions: `ruff check`, then `pytest` with a Postgres service container.

## Privacy and data
- Stored: email, password hash, account name, applications, interviews, session tokens.
- Sent to LLM providers: nothing today. From v1.2, only text the user explicitly submits, using their own key.
- Free-tier Gemini keys may use prompts for model training. The UI must warn before a user pastes personal text with such a key.
- No CV files are stored. Any CV feature (v2) uses an opt-in structured profile.
- Deletion on request now; self-serve account deletion in v1b.

## Extension points (hooks only, nothing built)
- **API tokens**: hashed personal tokens, accepted as `Authorization: Bearer` inside `get_current_user` next to cookies.
- **LLM provider interface**: one small interface behind which LiteLLM sits; BYO key, encrypted at rest, never logged.
- **JobSource interface**: yields job postings from legitimate feeds.
- **Per-user ownership**: every query is scoped by `created_by` through shared dependencies.
- **Secrets**: env vars only, never in git or logs.

Dev note: the Claude Code login is not an API key and must never power the app.

## Known limitations
Cold starts on free tier; Neon free-tier limits; no idle timeout; single region; no status history; no email delivery.

## Credits and inspiration
Ideas only, no copied code: career-ops (MIT), Resume-Matcher (Apache-2.0), JobSpy (MIT).
