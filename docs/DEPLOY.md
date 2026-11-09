# Deploy checklist (F7 draft)

Target: **Vercel** (Next, rewrites `/api/*`) -> **Render** (FastAPI, free web service) -> **Neon** (Postgres). Free `*.vercel.app` and `*.onrender.com` domains. The demo account is a separate, later milestone. This is a draft: tick items off during F7 and fix anything that turns out wrong.

## 1. Secrets and env vars

Generate once: `openssl rand -hex 32` (the proxy secret). Never commit real values.

| Where | Variable | Value |
|---|---|---|
| Render | `DATABASE_URL` | Neon string, `postgresql+psycopg2://...?sslmode=require`. See section 2 for pooled vs direct. |
| Render | `ENVIRONMENT` | `production` (the app refuses to start on a dev-grade config) |
| Render | `COOKIE_SECURE` | `true` (cookie becomes `__Host-session_token`) |
| Render | `ALLOWED_ORIGINS` | `https://<project>.vercel.app` (exact origin, no path, https, not localhost) |
| Render | `PROXY_SECRET` | the generated secret (at least 32 characters) |
| Render | `TRUST_PROXY` | `false` |
| Render | `BCRYPT_ROUNDS` | `12` (production refuses lower) |
| Render | `LOGIN_*`, `SIGNUP_*`, `ACCOUNT_DELETE_*` | defaults from `.env.example` unless tuning; each `*_WINDOW_SECONDS` at most 604800 (7 days, the purge cutoff) |
| Vercel | `BACKEND_URL` | `https://<service>.onrender.com`, no trailing slash. Read per request by `src/proxy.ts`. |
| Vercel | `PROXY_SECRET` | same value as on Render |
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
2. From your machine (never on boot): `DATABASE_URL=<direct string> python -m alembic upgrade head`, then `python -m alembic check`.
3. Create the Render web service with the env vars above. Wait for `/health` = 200.
4. Create the Vercel project (root directory `frontend`) with `BACKEND_URL` and `PROXY_SECRET`. Deploy.
5. Add the final Vercel origin to `ALLOWED_ORIGINS` on Render if it differs from the one you guessed. Redeploy Render.
6. Add the GitHub repo secret `DATABASE_URL` (direct string).
7. First invite code: `DATABASE_URL=<direct string> python -m app.admin create-invite --note "me" --expires-in 14d` (the code prints once).

## 4. Smoke test (record results here)

- [ ] `https://<service>.onrender.com/health` 200; `/ping` 200.
- [ ] `/docs`, `/redoc`, `/openapi.json` on the Render URL: 404.
- [ ] Render logs show no `Refusing to start`. A deliberate bad value (`COOKIE_SECURE=false`) on a throwaway deploy exits with the message.
- [ ] Open the Vercel URL, sign up with the invite code, log in, log out, log in again.
- [ ] Browser devtools: the cookie is `__Host-session_token`, HttpOnly, Secure, SameSite=Lax; no request goes to `onrender.com` from the browser.
- [ ] Create, edit and delete an application and an interview.
- [ ] **Per-visitor rate limits (the M11 fix):** from network A fail a login 10 times for different emails until 429; from network B (phone on mobile data) a login still answers 401, not 429. Also confirm the caps hold from A.
- [ ] **Header capture** (resolves the "medium" confidence in DECISIONS.md 2026-11-09): temporarily log, for one request, `X-Talaan-Client-IP` (present, equals your public IP), `X-Forwarded-For` and the socket peer on Render. Remove the logging after.
- [ ] A request straight to `onrender.com/api/v1/login` with a made-up `X-Talaan-Client-IP` and no/wrong secret: the bucket key is the socket peer, not the made-up IP.
- [ ] Caching: Vercel caches external rewrites that return `Cache-Control` (projects created on or after 2026-04-06). `/api/v1` sends `no-store`, so responses should show no `x-vercel-cache: HIT`. Check one.
- [ ] Manual run of the Purge workflow (Actions > Purge > Run workflow) prints `Purged N rate_limit_events, M sessions`.
- [ ] `alembic check` against Neon is clean.

## 5. Cold starts

- **Render free** spins the service down after about 15 minutes without traffic; the next request waits roughly a minute while it boots. Neon (free) suspends compute when idle and resumes on the first query, normally within about a second. Neither number is measured for this app yet.
- **Open question: does the Vercel rewrite wait that long?** Vercel's proxy timeout for an external rewrite is not verified here. Test: leave it idle 15+ minutes, then log in from the Vercel URL, and record the time and the result (success, a Vercel 5xx or timeout page, or a failed fetch in the UI). If it fails, options:
  1. A free keep-alive ping (an uptime monitor or a scheduled GitHub Actions `curl` of `/ping` every 10 minutes). Costs nothing; uses Render's free instance hours, which are limited per month (check the current allowance).
  2. A "waking up" state on the login screen: on a network error or 502/504 from login, show "The server is waking up, trying again" and retry a few times with backoff. No infrastructure, but the first visitor still waits.
  3. Both, or a paid always-on instance.
- GitHub pauses scheduled workflows after 60 days without repository activity; re-enable the Purge workflow in the Actions tab if that happens.

## 6. Not decided here

- The demo account (separate milestone).
- An origin lock (require the proxy secret on every `/api/v1` request): ROADMAP backlog.
- Email verification, Google OAuth: ROADMAP backlog.
