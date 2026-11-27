# Deploy checklist

Target: **Vercel** (Next, its proxy forwards `/api/*`) -> **Render** (FastAPI, free web service) -> **Neon** (Postgres). Free `*.vercel.app` and `*.onrender.com` domains. The demo account is a separate, later milestone. F7 is live; results are below, and the checklist in section 4 is ticked where the live deploy proved it.

## Verified on the live deploy (2026-11-09)

Deployed:
- Frontend: https://talaan-phi.vercel.app (Vercel, root directory `frontend`; `BACKEND_URL` and `PROXY_SECRET` set for Production only).
- API: https://talaan-0rhm.onrender.com (Render free web service, Singapore).
- Database: Neon Postgres (Singapore).

Results:
- API `/health` returns 200; `/docs` returns 404 (production mode).
- Sign-up with an invite code works.
- The session cookie is `__Host-session_token` with HttpOnly, Secure, SameSite=Lax, Path=/.
- An interview saved at 23:30 shows 23:30 PHT after a reload.
- `/api/docs` through Vercel returns FastAPI's `{"detail":"Not Found"}` (the rewrite reaches the API; docs stay off).
- Per-visitor rate limiting: a laptop on home Wi-Fi hit the per-IP block while a phone on mobile data was not blocked. This also proves that the proxy secret matches, that `VERCEL=1` is set at runtime and that the `X-Talaan-Client-IP` header arrives.
- Cold start: a login after 20+ minutes idle took 19 seconds and succeeded, with no Vercel timeout.
- A manual run of the Purge workflow printed `Purged 0 rate_limit_events, 0 sessions`.

### Gotchas we hit

- `DATABASE_URL` must use the `postgresql+psycopg2://` scheme. Neon shows plain `postgresql://`, which SQLAlchemy resolves to a driver that is not installed.
- Use the Neon **direct (unpooled)** string for alembic, the invite CLI and the `DATABASE_URL` repo secret of the purge workflow.
- Never put the Neon string in the local `.env`. Read it with `read -s` and pass it as a one-off `DATABASE_URL=...` prefix (see below).
- Vercel env vars: set them for Production only.
- Redeploy Vercel after changing an env var; running deployments keep the old values.
- Do NOT use Vercel's Services / multi-service preset. Import the `frontend` folder only (root directory `frontend`).

### Creating an invite code against production

Run from the repo root with the venv active. Paste Neon's direct string unchanged when prompted; nothing is echoed, and the scheme is rewritten to `postgresql+psycopg2://`:

```bash
read -rsp 'Neon direct URL: ' NEON_URL; echo
NEON_URL="postgresql+psycopg2://${NEON_URL#*://}"
DATABASE_URL="$NEON_URL" python -m app.admin create-invite
unset NEON_URL
```

The code prints once. Options: `--note TEXT` (who the code is for) and `--expires-in Nd|Nh` (1 hour to 365 days, default `14d`). `list-invites` and `revoke-invite ID` work the same way. `list-invites` also prints when each code was used and the account name that used it (`(deleted)` after account deletion), never an email, code or hash.

An admin (an account listed in `ADMIN_EMAILS`) can also create, list and revoke invites on the `/admin` page, reached from Account, with no terminal and no database string. The code is shown once, and the page caps unused invites at 50; the CLI has no cap.

### Password reset links: migrate before merging (A2)

The `password_reset_tokens` table must exist on Neon **before** the A2 PR merges: the new code and the daily purge both query it. From the repo root with the venv active, paste Neon's direct string when prompted:

```bash
read -rsp 'Neon direct URL: ' NEON_URL; echo
NEON_URL="postgresql+psycopg2://${NEON_URL#*://}"
DATABASE_URL="$NEON_URL" python -m alembic upgrade head
DATABASE_URL="$NEON_URL" python -m alembic check
unset NEON_URL
```

`alembic upgrade head` applies both password reset migrations in order: first `password_reset_tokens`, then the `created_by` `ON DELETE CASCADE` change (a separate revision, because the first may already be applied elsewhere). `alembic check` after it must report no new upgrade operations.

A reset link for an admin account (the page refuses those) comes from the CLI, with the same `read -rsp` lines: `DATABASE_URL="$NEON_URL" python -m app.admin create-reset-link EMAIL`. It prints `/reset#<token>` once; put the frontend's origin in front of it.

### Invite requests: migrate before merging (A3)

The `invite_requests` table must exist on Neon **before** the A3 PR merges: the new code and the daily purge both query it, and the purge runs that step first. From the repo root with the venv active, paste Neon's direct string when prompted:

```bash
read -rsp 'Neon direct URL: ' NEON_URL; echo
NEON_URL="postgresql+psycopg2://${NEON_URL#*://}"
DATABASE_URL="$NEON_URL" python -m alembic upgrade head
DATABASE_URL="$NEON_URL" python -m alembic check
unset NEON_URL
```

`alembic check` after it must report no new upgrade operations.

`INVITE_REQUEST_PENDING_CAP` (Render, optional, default 50) is the number of undecided requests allowed. When it is reached, requests close for everyone until you decide or delete some at `/admin`. The per-IP limits are `INVITE_REQUEST_IP_*` (5 per hour) and `INVITE_REQUEST_STATUS_IP_*` (30 per hour).

## 1. Secrets and env vars

Generate once: `openssl rand -hex 32` (the proxy secret). Never commit real values.

| Where | Variable | Value |
|---|---|---|
| Render | `DATABASE_URL` | Neon string, `postgresql+psycopg2://...?sslmode=require`. See section 2 for pooled vs direct. |
| Render | `ENVIRONMENT` | `production` (the app refuses to start on a dev-grade config) |
| Render | `COOKIE_SECURE` | `true` (cookie becomes `__Host-session_token`) |
| Render | `ALLOWED_ORIGINS` | `https://<project>.vercel.app` (exact origin, no path, https, not localhost) |
| Render | `EXTENSION_ORIGINS` | `chrome-extension://fjlnbbkeadlpibmnbpfhlgeingifocni,chrome-extension://icpdblljdbhfckncojpohbnfdkblgill` (the pinned ID for unpacked and friends installs, then the Chrome Web Store ID), comma-separated, exact match (no wildcard, no trailing slash) |
| Render | `PROXY_SECRET` | the generated secret (at least 32 characters) |
| Render | `TRUST_PROXY` | `false` |
| Render | `BCRYPT_ROUNDS` | `12` (production refuses lower) |
| Render | `ADMIN_EMAILS` | comma-separated emails of admins (for example `admin@example.ph`), set in the Render dashboard only (never in a committed file). Unset or empty = the admin page is off (the app still starts). It must name an account that already exists: emails are not verified, so an address with no account could be claimed by anyone holding a valid invite. Remove the address before deleting that account. Accepted until email verification exists. |
| Render | `ADMIN_INVITE_USER_LIMIT`, `ADMIN_INVITE_IP_LIMIT` and their `*_WINDOW_SECONDS` | defaults 10 attempts per user and per IP per 3600 seconds (`POST /admin/invites`); window at most 604800 |
| Render | `ADMIN_RESET_USER_LIMIT`, `ADMIN_RESET_IP_LIMIT`, `RESET_PASSWORD_IP_LIMIT` and their `*_WINDOW_SECONDS` | optional; defaults 10 per 3600 seconds (reset link creation per admin and per IP; password reset per IP); window at most 604800 |
| Render | `LOGIN_*`, `SIGNUP_*`, `ACCOUNT_DELETE_*` | defaults from `.env.example` unless tuning; each `*_WINDOW_SECONDS` at most 604800 (7 days, the purge cutoff) |
| Vercel | `BACKEND_URL` | `https://<service>.onrender.com`, no trailing slash. Read per request by `src/proxy.ts`. |
| Vercel | `PROXY_SECRET` | same value as on Render |
| Vercel | `TRUST_X_REAL_IP` | leave unset. Vercel sets `VERCEL=1` itself, which is what lets `src/proxy.ts` trust `x-real-ip`. Only another host with a proxy you control that overwrites `x-real-ip` sets `true`. |
| GitHub (repo secret) | `DATABASE_URL` | Neon **direct (unpooled)** string, for `.github/workflows/purge.yml` |

Start command on Render: `uvicorn app.main:app --host 0.0.0.0 --port $PORT --no-proxy-headers` (the Dockerfile may already do this; check). Rotate `PROXY_SECRET` by changing it on both services; requests between the two changes get their IP from the socket until both are live.

Startup errors are the check: a wrong production config exits with `Refusing to start in production: ...` listing every problem.

## 2. Neon: pooled vs direct connection string

- Use the **direct (unpooled)** string for `alembic upgrade head` and for the purge job: migrations and the purge need ordinary sessions.
- The limiter takes **transaction-level** advisory locks (`pg_advisory_xact_lock`) and holds them from prune to commit. Neon's pooled endpoint is PgBouncer in transaction mode: xact locks should work there, session-level locks would not, but this is **not tested**. Test the API against both strings before choosing the pooled one for Render:
  1. Run the API on the direct string. Run the burst checks (`docs/API.md`, rate-limit section): exactly 10 x 401 then 429 for one IP, and the concurrent tests (`pytest tests/auth/test_rate_limit_concurrency.py` with `TEST_DATABASE_URL` pointed at a throwaway Neon branch).
  2. Repeat on the pooled string. Any difference (extra 429s, errors under concurrency, "prepared statement" errors) means use direct.
  3. Default if unsure: direct. One free-tier web service does not need pooling.
- Measure how long a login holds the lock on Neon (8-10 statements; ROADMAP backlog).

## 3. First deploy steps

1. Create the Neon project and a database. Note both connection strings.
2. From your machine (never on boot): `DATABASE_URL=<direct string> python -m alembic upgrade head`, then `python -m alembic check`. Alembic needs the `postgresql+psycopg2://` scheme: Neon's own string starts with `postgresql://`, which picks the psycopg driver here, so change the prefix.
3. Create the Render web service with the env vars above. Wait for `/health` = 200.
4. Create the Vercel project (root directory `frontend`) with `BACKEND_URL` and `PROXY_SECRET`. Deploy.
5. Add the final Vercel origin to `ALLOWED_ORIGINS` on Render if it differs from the one you guessed. Redeploy Render.
6. Add the GitHub repo secret `DATABASE_URL` (direct string).
7. First invite code: see "Creating an invite code against production" above (the code prints once).

## 4. Smoke test (record results here)

- [x] `https://<service>.onrender.com/health` 200. (`/ping` not recorded.)
- [x] `/docs` on the Render URL: 404. (`/redoc`, `/openapi.json` use the same switch; not recorded.)
- [ ] Render logs show no `Refusing to start`. A deliberate bad value (`COOKIE_SECURE=false`) on a throwaway deploy exits with the message.
- [x] Open the Vercel URL, sign up with the invite code, log in, log out, log in again. (Sign-up with an invite code recorded; the rest not recorded separately.)
- [x] Browser devtools: the cookie is `__Host-session_token`, HttpOnly, Secure, SameSite=Lax, Path=/; no request goes to `onrender.com` from the browser.
- [ ] Create, edit and delete an application and an interview.
- [x] **Per-visitor rate limits (the M11 fix):** from network A fail a login 10 times for different emails until 429; from network B (phone on mobile data) a login still answers 401, not 429. Also confirm the caps hold from A. Done 2026-11-09: laptop on home Wi-Fi blocked, phone on mobile data not blocked.
- [x] **`VERCEL=1` seen at runtime:** proven by the per-visitor test above (without `VERCEL=1` every visitor would share one bucket).
- [x] **Header capture** (resolves the "medium" confidence in DECISIONS.md 2026-11-09): done by behavior instead of logging. The per-visitor test only passes if `X-Talaan-Client-IP` arrives with a matching secret, so no temporary logging was added.
- [ ] A request straight to `onrender.com/api/v1/login` with a made-up `X-Talaan-Client-IP` and no/wrong secret: the bucket key is the socket peer, not the made-up IP.
- [ ] Caching: Vercel caches external rewrites that return `Cache-Control` (projects created on or after 2026-04-06). `/api/v1` sends `no-store`, so responses should show no `x-vercel-cache: HIT`. Check one.
- [x] Manual run of the Purge workflow (Actions > Purge > Run workflow) prints `Purged N rate_limit_events, M sessions`. First run: `Purged 0 rate_limit_events, 0 sessions`.
- [ ] `alembic check` against Neon is clean.
- [ ] **After the first week:** check Vercel usage once (function/proxy invocations, CPU) against the free limits. Every `/api` request runs `src/proxy.ts` on purpose (DECISIONS.md 2026-11-09, client IP entry).

## 5. Cold starts

- **Render free** spins the service down after about 15 minutes without traffic; the next request waits while it boots. Neon (free) suspends compute when idle and resumes on the first query.
- **Answered (2026-11-09): the Vercel rewrite waits.** A login after 20+ minutes idle took 19 seconds and succeeded, with no Vercel timeout. Follow-ups are in the ROADMAP backlog (a "waking up" message on the login screen; no keep-alive ping that touches the database). Options considered, kept for reference:
  1. A free keep-alive ping (an uptime monitor or a scheduled GitHub Actions `curl` of `/ping` every 10 minutes). Costs nothing; uses Render's free instance hours, which are limited per month (check the current allowance).
  2. A "waking up" state on the login screen: on a network error or 502/504 from login, show "The server is waking up, trying again" and retry a few times with backoff. No infrastructure, but the first visitor still waits.
  3. Both, or a paid always-on instance.
- GitHub pauses scheduled workflows after 60 days without repository activity; re-enable the Purge workflow in the Actions tab if that happens.

## 6. Not decided here

- The demo account (separate milestone).
- An origin lock (require the proxy secret on every `/api/v1` request): ROADMAP backlog.
- Email verification, Google OAuth: ROADMAP backlog.
