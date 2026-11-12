# Decision: Session Lifetime

- **Date:** 2025-02-14
- **Decision:** Use a 30-day session lifetime.
- **Rationale:** The application handles low-stakes data—job applications rather than financial or otherwise sensitive information—so the convenience of a longer-lived session outweighs the associated security trade-off.
---

# Decision: Job Application and Interview schema, enums, Alembic baseline

- **Date:** 2026-10-20
- **Decision:** Schema is owned by Alembic (one baseline migration, all four tables). Models match the CLAUDE.md spec with the choices below.
- **ENUMs (native Postgres ENUM types, lowercase snake_case values):**
  - `application_status`: applied, screening, interviewing, offered, accepted, rejected, withdrawn, ghosted
  - `mode_of_work`: on_site, hybrid, remote
  - `interview_mode`: on_site, online, async
  - `interview_outcome`: pending, good, bad (server default `pending`)
  - Tradeoff: native ENUMs enforce values in the DB, but adding a value needs `ALTER TYPE ... ADD VALUE` and removing or renaming one means recreating the type. Alternative was VARCHAR + CHECK, easier to evolve but weaker in the schema.
- **Nullability:** `remarks` is nullable Text on both tables (spec had no `?`; free notes should not be forced). `Interview.interviewer` is nullable because async interviews may have none.
- **Salary convention:** `salary` is an integer holding monthly gross pay in PHP. There is no currency column for now; add one (and a migration) if non-PHP offers need tracking.
- **`date_applied`:** `Date`, not a timestamp, so it does not use the `_at` suffix. The time of day is not meaningful.
- **Timestamps:** `created_at`/`updated_at` are `DateTime(timezone=True)`, NOT NULL, `server_default=now()`; `updated_at` also has ORM-side `onupdate`. Raw SQL updates will not bump `updated_at`; add a trigger if non-ORM writes appear.
- **Foreign keys:** `job_applications.created_by` and `interviews.job_application_id` use `ON DELETE CASCADE` and are indexed (Postgres does not index FK columns automatically, and every CRUD query filters on them). `sessions.user_id` is unchanged for now (see CLAUDE.md backlog).
- **Downgrade:** autogenerate does not drop native enum types, so the baseline `downgrade()` drops them explicitly. Verified: upgrade, `alembic check`, downgrade, upgrade again on a fresh DB.

---

# Decision: Rename ApplyFlow to Talaan

- **Date:** 2026-10-20
- **Decision:** The project is renamed Talaan (Tagalog for "record" or "list"). Container is `talaan-db`, volume `talaan_pgdata`, Postgres user and database `talaan`. Compose no longer defaults the database password; a missing `.env` fails loudly.
- **Rationale:** The name ApplyFlow collides with applyflow.com. The Filipino name also fits the target audience.
- **Alternative:** Keep the name and accept the collision. Rejected because it hurts discoverability and risks confusion.

---

# Correction: Session Lifetime entry date

- **Date:** 2026-10-20
- **Decision:** The "Session Lifetime" entry above is dated 2025-02-14, which is wrong. Git history shows it was added in commit `efce6ae` on 2026-09-11, so the decision dates to 2026-09-11 or earlier. The exact day is unverified. The decision itself is unchanged. The original entry is left as written.

---

# Decision: Invite-code signup

- **Date:** 2026-10-20
- **Decision:** Signup requires an invite code from an env var, behind a swappable `check_signup_allowed()`. Planned for v1b.
- **Rationale:** The app is for friends and family on a free tier. Open signup invites spam and cost.
- **Alternative:** Open signup with email verification; heavier and needs email delivery.

---

# Decision: Bring-your-own LLM keys

- **Date:** 2026-10-20
- **Decision:** Any LLM feature (v1.2+) uses the user's own provider key, encrypted at rest and never logged, through a provider-agnostic layer (LiteLLM).
- **Rationale:** No shared API bill, no key custody by the app owner. The Claude Code login is not an API key and is never used.
- **Alternative:** A single server key; rejected for cost and abuse risk.

---

# Decision: No CV file storage

- **Date:** 2026-10-20
- **Decision:** CV files are never stored. CV features (v2) use an opt-in structured profile only.
- **Rationale:** CVs hold sensitive personal data; not storing them removes a large liability.
- **Alternative:** Store uploads encrypted; rejected as unnecessary risk for a free-tier hobby host.

---

# Decision: Gmail is request-only

- **Date:** 2026-10-20
- **Decision:** Gmail integration (v3) is request-only for allowlisted test users: read on explicit user action, no background inbox scanning.
- **Rationale:** Gmail read scopes are restricted and need Google review; inbox access is highly sensitive.
- **Alternative:** Continuous sync; rejected for privacy and verification cost.

---

# Decision: Calendar is manual first

- **Date:** 2026-10-20
- **Decision:** v1c exports interviews as `.ics` plus an "Add to Google Calendar" link (no OAuth). Auto-sync waits for v3.
- **Rationale:** Covers most of the value with no OAuth scopes or tokens to protect.
- **Alternative:** Calendar API sync now; rejected as premature.

---

# Decision: Neon pooled vs direct URLs

- **Date:** 2026-10-20
- **Decision:** The app connects through Neon's pooled URL; Alembic migrations use the direct URL. `pool_pre_ping=True`.
- **Rationale:** The pooler (PgBouncer, transaction mode) suits many short app connections but is unreliable for migrations (session state, DDL locks).
- **Alternative:** One URL for both; risks flaky migrations or exhausting connections.

---

# Decision: Render + Neon over Render Postgres

- **Date:** 2026-10-20
- **Decision:** Host the API on Render free web service and the database on Neon free Postgres.
- **Rationale:** Render's free Postgres expires after a short period; Neon's free tier does not expire and has a pooler.
- **Alternative:** Render Postgres; rejected because the database would be lost or need paying for.

---

# Decision: Responsive PWA for desktop and mobile

- **Date:** 2026-10-20
- **Decision:** The later frontend (Vercel) is one responsive, mobile-first PWA with a share target ("Share to Talaan"). A native Flutter app is optional and not committed.
- **Rationale:** One codebase covers desktop and phones; the share target gives mobile capture without an app store.
- **Alternative:** Native apps first; rejected for cost and review overhead.

---

# Decision: `saved` status and nullable `date_applied`

- **Date:** 2026-10-20
- **Decision:** Add `saved` to `application_status` (before `applied`) and make `date_applied` nullable. The server sets `date_applied` when status moves to `applied`. Planned for v1a as a new migration; the model is not changed yet.
- **Rationale:** Quick-add and the browser extension must save jobs not yet applied to.
- **Tradeoff:** Postgres cannot drop an enum value, so the downgrade must map `saved` rows and recreate the type. Making `date_applied` nullable again also needs a backfill.
- **Alternative:** A separate `saved_jobs` table; rejected because it duplicates the application fields.

---

# Decision: Idempotent logout (204)

- **Date:** 2026-10-20
- **Decision:** `POST /logout` always returns 204 and clears the `session_token` cookie. It deletes the session row if the token matches one, and succeeds quietly for a missing, invalid, or already-deleted token.
- **Rationale:** Logging out twice is harmless, the response does not reveal whether a token was valid, and it matches the 204 in docs/API.md.
- **Alternative:** 401 for a missing or invalid token; rejected because a repeat or stale logout would error for no security gain.

---

# Decision: /health and /ping at the root, unversioned

- **Date:** 2026-10-20
- **Decision:** `GET /health` (runs `SELECT 1`, 503 on database failure) and `GET /ping` (no database work) live at the root, outside `/api/v1`. Business routes live under `/api/v1`.
- **Rationale:** Uptime pingers and Render's health check should not break when the API version bumps. `/ping` touches no database, so a free uptime pinger can keep a free instance warm without loading Neon.
- **Alternative:** Mount both under `/api/v1`; rejected because every version bump would force a change to deploy and pinger config.

---

# Decision: `saved` migration, date-fill rule, sort, updated_at clock

- **Date:** 2026-10-21
- **Decision:** (1) Migration `saved_status_nullable_date_applied` adds `saved` and makes `date_applied` nullable. It is hand-written because autogenerate misses enum changes. The downgrade raises `RuntimeError` with a row count if any `saved` or NULL-date rows exist, then recreates the enum without `saved`. (2) For a non-`saved` row with no `date_applied`, the server sets today in Asia/Manila (fixed +08:00, no DST, no tzdata); a client date wins; returning to `saved` keeps the date. (3) Default list order is `created_at DESC, id DESC`; the id tiebreaker keeps pages stable. (4) `JobApplication.updated_at` uses `onupdate=clock_timestamp()` because `now()` is frozen for a whole transaction, so a PATCH in the same transaction could not change it.
- **Rationale:** Rows are never silently rewritten on downgrade; one timezone makes the date predictable for a PH user; stable pagination.
- **Alternative:** Auto-map `saved` rows on downgrade (loses data meaning); `sort by date_applied` (NULL for saved rows).

---

# Decision: Interviews CRUD (ownership, order, whitespace, no-store middleware)

- **Date:** 2026-10-21
- **Decision:** (1) Interviews have no owner column; ownership is the parent application's `created_by`. Nested routes reuse `get_owned_application`; by-id routes use `get_owned_interview`, which joins `job_applications` and returns 404 for missing and not-owned alike. (2) Default list order is `scheduled_at ASC, id ASC`: rounds read chronologically and the id tiebreaker keeps pages stable. (3) A whitespace-only `interviewer` is 422, not null (same rule as application names); `null` is the explicit "none". (4) `scheduled_at` must be timezone-aware and between years 1900 and 2200; the instant is stored and returned in UTC, the sent offset is not kept. (5) `Cache-Control: no-store` is set by one middleware on every `/api/v1` response, replacing the per-router dependency. (6) `Interview.updated_at` uses `clock_timestamp()` (ORM-only, no migration).
- **Rationale:** One owner of truth avoids a second column that could drift from the parent. A middleware also covers 401/404/422 responses and `/me`, which a router dependency missed. The year bound stops a 500 from datetime overflow found in the security pass.
- **Alternative:** Denormalized `user_id` on interviews (faster check, can drift); descending order (newest first, but rounds read backwards); coercing blank `interviewer` to null (silent rewrite); storing the offset in a column (more schema for little value, the .ics export uses UTC).

---

# Decision: CI on GitHub Actions

- **Date:** 2026-10-21
- **Decision:** One workflow, `.github/workflows/ci.yml`, runs on every `pull_request` and on `push` to `main` only. It has one job on Python 3.14 (the version in the local venv) with a Postgres 16 service container. Lint, `alembic upgrade head`, `alembic check` and `pytest` run as separate steps. `permissions: contents: read`, a concurrency group cancels older runs on the same branch, and `timeout-minutes: 10` caps a hung run. Config is env vars only: `DATABASE_URL` and `TEST_DATABASE_URL` both point at `talaan_test`, with a throwaway password for the CI-only container. There are no secrets and no committed `.env`.
- **Rationale:** Matches the checks run by hand and costs $0 on the free tier. Limiting `push` to `main` stops a same-repo PR branch from running twice. Separate steps show which check broke.
- **Alternative:** A Python version matrix (more minutes, one deploy target); `push` on all branches (duplicate runs); a repository secret for the DB password (nothing to protect in a throwaway container).

---

# Decision: Docker image for the API

- **Date:** 2026-10-21
- **Decision:** (1) Base `python:3.14-slim`, the minor tag CI uses; `psycopg2-binary` bundles libpq, so no apt packages or build tools. (2) The container runs as non-root user `app` (uid 10001). (3) One uvicorn worker, no gunicorn. (4) Migrations do not run on container start; run `docker compose run --rm api python -m alembic upgrade head`. (5) The image copies only `requirements.txt`, `alembic.ini`, `alembic/` and `app/`; `.env` is never copied. (6) In compose, `POSTGRES_PASSWORD` defaults to `change-me` (the `.env.example` placeholder) instead of failing, so `docker compose build` works from a clean checkout; `.env` still overrides it.
- **Rationale:** Auto-migrate on start lets several replicas race on the same DDL, and a failed migration would crash-loop the API; schema changes stay an explicit step (Render can run it as a pre-deploy command in v1b). The app boots without tables, so there is no crash loop before the first migrate. One worker fits free-tier memory; scale with instances. Non-root limits what a compromised process can do in the container. Slim is much smaller than the full image and keeps glibc wheels working.
- **Alternative:** Auto-migrate in an entrypoint (race, hidden failures); `alpine` (musl, wheel and build trouble); gunicorn with workers (more memory, no need yet); keeping the `:?` guard on the password (blocks no-.env builds).

---

# Decision: Session tokens hashed at rest (SHA-256)

- **Date:** 2026-10-21
- **Decision:** (1) `sessions.token` is renamed `token_hash` and holds `sha256(token).hexdigest()`; the cookie keeps the raw token. Hashing lives in `hash_session_token` (`app/auth/security.py`); login stores the digest, and `get_current_user` and `/logout` hash the cookie value and look up by equality on the unique index. (2) The migration deletes all sessions before the rename, in both directions: plaintext rows cannot be safely converted and a digest cannot be reversed, so users log in again once. (3) An empty or missing cookie returns the same 401 (or 204 on logout) without a query. (4) No pepper or HMAC key for now.
- **Rationale:** The token is 256 bits from `secrets.token_urlsafe(32)`. There is nothing to guess, so there is no dictionary or brute-force attack for a slow hash to resist; bcrypt would only add tens of milliseconds of CPU to every authenticated request. A fast hash is enough to make a leaked dump (backup, SQL injection, Neon snapshot) useless for logging in. The lookup is a database equality on the digest, so response timing reveals nothing usable about the raw token. A pepper would only help if the app secret survived a database leak; it is a possible later step.
- **Alternative:** bcrypt or argon2 for tokens (slow, no benefit at this entropy); HMAC with a server key (adds a secret to manage and rotate); converting existing rows in place (impossible for plaintext without keeping it); keeping the old column and adding a new one (two sources of truth).

---

# Decision: Frontend scaffold defaults (Next.js flags, browser floor)

- **Date:** 2026-10-27
- **Decision:** (1) `cacheComponents` and `partialPrefetching`, which `create-next-app` 16.4.3 enabled in `next.config.ts`, are removed; the build passes without them. (2) `frontend/package.json` sets `browserslist` to Chrome and Edge 123, Firefox 120, Safari and iOS Safari 17.5. (3) `agentRules: false` stops `next dev` from re-creating `frontend/AGENTS.md`.
- **Rationale:** (1) Both flags change Next's caching and prefetch model, and F1 has no data fetching, so they add behavior to learn and debug with no benefit; add them back when a screen needs them. (2) Colors are written once as `light-dark()`. With an older floor, Next's CSS tooling rewrites `light-dark()` into a variable toggle that resolves at `:root`, so a `[data-theme]` subtree (the light and dark panels on `/design`, and later any scoped theme) shows the wrong theme. These versions are the first with native `light-dark()` support in each engine. (3) Rules for the repo live in the root CLAUDE.md.
- **Alternative:** Keep the flags (more surface, nothing used); duplicate every dark value in `:root`, `[data-theme=dark]` and a media query (each token written twice, contrast test must parse both); a lower browser floor with the toggle hack (breaks scoped themes).

---

# Decision: Firefox floor raised to 121 (`:has()`)

- **Date:** 2026-10-28
- **Decision:** `frontend/package.json` `browserslist` moves from Firefox 120 to Firefox 121. Chrome/Edge 123 and Safari/iOS Safari 17.5 are unchanged. This amends point (2) of the 2026-10-27 frontend scaffold entry.
- **Rationale:** The components style state with `:has()`: the segmented control and theme toggle highlight the checked radio (`has-checked:`), draw the focus ring on the visible segment (`has-focus-visible:`), and the select shows its placeholder style when the empty option is selected. Firefox 121 is the first Firefox with `:has()`; on 120 those states would silently not render. The other engines in the floor already support it.
- **Alternative:** JavaScript state for each of these (more code, and the select would need to be controlled); keep 120 and accept broken selected and focus styles there.

---

# Decision: Toast caps are per kind

- **Date:** 2026-11-02
- **Decision:** At most 3 success toasts and 3 error toasts are visible. A fourth of either kind drops the oldest toast of that same kind. This replaces the F2b rule (3 in total, oldest success dropped first), recorded in DESIGN.md 6.9.
- **Rationale:** Errors never auto-dismiss. Under the shared cap, 3 errors on screen meant a new success was dropped in the same update, so a retry that worked showed no confirmation and screen readers announced nothing.
- **Alternative:** Keep one cap of 3 and drop the oldest error instead (hides an unresolved error); no cap (a burst of errors covers the screen).

---

# Decision: Sign up asks for the invite code first

- **Date:** 2026-11-02
- **Decision:** The Create account fields are in this order: Invite code, Account name, Email, Password. DESIGN.md section 8 item 1 changes to match (the only DESIGN.md edit in F3). This follows the Stitch screen instead of the earlier DESIGN.md order.
- **Rationale:** Signup is by invitation. The invite code gates it, so a person without a valid code finds out before filling in three other fields.
- **Alternative:** Keep the code last (DESIGN.md v2.2), which puts the field most likely to fail at the end of the form.

---

# Decision: Deny the unrs-resolver install script

- **Date:** 2026-11-03
- **Decision:** `frontend/package.json` `allowScripts` has `"unrs-resolver": false` (an npm deny-list entry, not a new dependency): this transitive ESLint resolver's postinstall only re-checks a native binding that its platform `optionalDependencies` already install, so denying it removes install-time code execution at no cost (lint and tests pass on a clean `npm ci`).

---

# Decision: Tablet rail is 88px

- **Date:** 2026-11-03
- **Decision:** The navigation rail from 768 to 1279 is 88px wide, up from 80px. The content offset (`md:pl-22`) matches. This amends DESIGN.md section 7 (the approved DESIGN.md edit for this change) and the CLAUDE.md route note.
- **Rationale:** The bold "Applications" label does not fit in an 80px rail. At 88px it fits with `tracking-tight` (77px label in a 79px pill).
- **Alternative:** Keep 80px and shrink the label token or abbreviate the label (worse legibility, and a second token only for the rail).

---

# Decision: Auth rate limiting in Postgres, and constant-work login

- **Date:** 2026-11-03
- **Decision:** Login and signup are rate limited with a sliding window stored in a new `rate_limit_events` table (key, created_at; index on both). Defaults, all from env: login 10 attempts per IP and 5 failed attempts per email per 15 minutes; signup 5 per IP per hour. Over the limit returns 429 with `Retry-After` and one body for every limit. Each check deletes the checked key's expired rows, so no cron is needed.
- **Why Postgres:** Render free restarts and spins down, which would reset in-memory counters. Redis would cost money. The table costs one indexed query pair per attempt.
- **Why both IP and email keys:** the IP limit stops one client trying many emails; the email limit stops many IPs (or a botnet) guessing one account. Email keys are the SHA-256 of the stripped, lowercased address, so no raw email is stored and any length gives a fixed-length key. Unknown emails are counted too; otherwise only real accounts could be locked and that would reveal them.
- **Client IP:** the socket peer. Only with `TRUST_PROXY=true` is the right-most `X-Forwarded-For` value used (the one our own proxy appended; everything to its left is client-controlled). `TRUST_PROXY` is the only trust switch: uvicorn runs with `--no-proxy-headers`, otherwise it would rewrite the peer from forwarded headers on its own. IPv6 is bucketed to its /64 and IPv4-mapped IPv6 is unwrapped. A missing or invalid address maps to the shared key `unknown`, so it is still limited. The Render proxy hop must be checked at deploy (M11).
- **Login timing:** an unknown email now verifies against a dummy bcrypt hash built once at startup with the same algorithm and cost, and returns the same 401 as a wrong password. No early return. Passwords over 72 bytes (which bcrypt 5 rejects with an exception) are hashed on their first 72 bytes for equal cost and then rejected, so they return 401 instead of 500; signup already refuses them.
- **Fail closed:** a DB error in the limiter returns 503, never a pass. 503 and not 429 because the fault is ours and a 429 would invent a `Retry-After`. Login cannot work without the DB anyway.
- **Accepted trade-offs:**
  - Check-then-record is not atomic, so concurrent requests can overshoot a limit by a small amount.
  - Successful logins count against the per-IP limit, so a shared IP (campus, office) can hit it. Accepted for now; raise `LOGIN_IP_LIMIT` if it happens.
  - An attacker who knows an email can lock it for the window with bad guesses. The owner can log in again when the window passes.
  - Rows are pruned per key only. Keys that never return, and expired sessions, stay until a purge exists. That purge is a blocker for M11.
- **Duplicate-email leak (partial fix):** signup still reveals whether an email exists (400 "Email already exists."). The response is unchanged. Enumeration is now limited by the signup rate limit and, in M9, by the invite code. The full fix is email verification, planned for a later milestone.
- **Alternative:** in-process counters (reset on restart, one per worker); `slowapi` (new dependency, still needs a store); a CAPTCHA (cost, frontend work).

---

# Decision: BCRYPT_ROUNDS stays fixed after launch

- **Date:** 2026-11-03
- **Decision:** Once real accounts exist, `BCRYPT_ROUNDS` does not change. Tests still set 4 through the environment.
- **Rationale:** a stored hash keeps the cost it was made with, but the login dummy hash for unknown emails is built at startup with the current `BCRYPT_ROUNDS`. If the cost changes, unknown emails and real accounts take different times to verify (one step up roughly doubles the time), so response time again reveals which emails are registered: the gap the constant-work login closed.
- **Possible future change:** rehash on successful login. Read the cost from the stored hash prefix (`$2b$12$`), and when it differs from `BCRYPT_ROUNDS`, store a new hash of the password just verified. Even then, accounts that never log in keep the old cost, so a cost change still needs a plan for them.
- **Alternative:** build rehash-on-login now. Not worth it yet: before launch every hash already has cost 12.

---

# Decision: Rate limits are exact per key (advisory lock)

- **Date:** 2026-11-03
- **Decision:** This replaces the accepted trade-off in "Auth rate limiting in Postgres" that concurrent requests may overshoot a limit. `rate_limit.enforce()` takes `pg_advisory_xact_lock(hashtext(key))` for each key, then prunes, counts and either inserts the attempt or returns the 429 wait, all in one transaction. Concurrent callers on the same key wait for each other, so a burst lets exactly `limit` attempts through. Login locks its two keys (IP, email) in sorted order, so two logins cannot deadlock.
- **Why:** manual testing sent 20 parallel logins for a fresh email and got 16x 401 instead of 5. Every request passed the count before any insert was committed, so even the per-IP limit of 10 was exceeded.
- **Lock scope:** transaction-scoped, released by the commit that happens before bcrypt runs, so slow password checks never hold it. A rollback (fail-closed 503) also releases it. Because nothing outlives the transaction, this works with Neon's pooled (PgBouncer, transaction mode) connections. A session-level `pg_advisory_lock` would not: the pooler can give the next transaction a different server connection.
- **Cost:** requests on the same key are serialized for the length of a short transaction (a few milliseconds). A `hashtext` collision makes two unrelated keys share a lock, which only adds waiting.
- **Alternative:** `SERIALIZABLE` isolation with retries (more code, retries on every conflict), or a per-key counter row updated with `SELECT ... FOR UPDATE` (needs an upsert first, and a different table shape).

---

# Decision: A successful login deletes only its own email attempt

- **Date:** 2026-11-03
- **Decision:** This replaces "a successful login clears the email key" (the login route deleted every row on the email key). `rate_limit.record()` now returns the new row id and `enforce()` returns `{key: id}`. On a successful login the route deletes only this attempt's email-key row, in the same transaction that creates the session. The IP row stays counted, and every other row on the email key stays. Attempts are still recorded and committed before bcrypt runs.
- **Why:** clearing the whole key let the account owner reset an attacker's budget. An attacker spreading guesses for one email across many IPs got a fresh 5 guesses every time the owner logged in (several devices, an app re-login). It also deleted failures that other connections recorded between this request's `enforce()` commit and its success, so the per-email count was not exact.
- **Effect:** the per-email limit now counts failed attempts only. A success does not use up the budget (six successes in a row all work), and it does not refund failures either: after 4 failures and 1 success, the next failure is the 5th.
- **No lock for the delete:** removing one row can only free budget. A concurrent caller that counted the row before it was deleted is at worst stricter for that one check.
- **Cost:** the owner can still be locked out for the window by someone who knows the email (the accepted trade-off in "Auth rate limiting in Postgres"). `record()` flushes each row to get its id, so login sends two INSERTs instead of one batched INSERT: one extra round trip inside the locked transaction.
- **Alternative:** keep clearing the key (resets attacker budgets); record attempts only after a failed verify (drops the record-before-verify order, so concurrent guesses would not see each other during bcrypt).

---

# Decision: Advisory lock ids come from SHA-256, locked in id order

- **Date:** 2026-11-03
- **Decision:** This replaces the lock id and lock order in "Rate limits are exact per key". `enforce()` no longer calls `pg_advisory_xact_lock(hashtext(key))` in key-string order. It computes each key's lock id in Python (the first 8 bytes of SHA-256 of the key, as a signed 64-bit int), removes duplicate ids, and takes `pg_advisory_xact_lock(:id)` in ascending id order.
- **Why:** sorting by key string does not order the locks themselves. If two keys collide on one id, two callers can take the same ids in opposite orders (A locks [a, b] = ids [5, 1], B locks [c, d] = ids [1, 5]) and deadlock. Postgres aborts one, `fail_closed` turns that into a 503, and a valid login fails. Sorting by id gives every caller the same order for shared locks, so no wait cycle can form. `hashtext` is 32-bit, so collisions were plausible at scale; 64 bits makes them far rarer, and the ordering makes them harmless anyway (extra waiting only).
- **Test:** a burst with a mocked id function that forces the collision above. With key-string order it fails with 503s (deadlock), three runs out of three; with id order it passes.
- **Alternative:** one combined lock per call (hash of all keys). Unrelated calls that share one key would then not serialize on it, which breaks exactness.

---

# Decision: Invite-code signup (hashed, single-use, CLI-managed)

- **Date:** 2026-11-03
- **Decision:** `POST /signup` requires an `invite_code`. Codes live in a new `invite_codes` table (`code_hash` unique, `note`, `created_at`, `expires_at`, `used_at`, `used_by_user_id`). A code is 12 Crockford base32 characters from `secrets`, shown as `TLN-XXXX-XXXX-XXXX`. Input is normalized (strip, uppercase, drop dashes and whitespace, optional `TLN`) and capped at 64 characters before hashing. Codes are created, listed and revoked with `python -m app.admin`. There is no admin HTTP endpoint and no bypass flag.
- **Supersedes:** the v1b roadmap line "invite code via env var behind a swappable check_signup_allowed()". The roadmap text is left as written (its own rule); a table gives single use and expiry per person, which one shared env value cannot.
- **Hashed like session tokens:** only the SHA-256 is stored, so a database read does not hand out working codes. The plaintext is printed once by `create-invite` and is never logged or returned by the API.
- **Single use plus expiry (default 14 days, 1h to 365d):** limits how long a leaked or forwarded code is useful.
- **CLI, not an endpoint:** an endpoint needs its own admin auth, which costs work and adds attack surface. The CLI needs only database access. Zero budget, no new dependency.
- **Order inside signup:** rate limit (records the attempt, so bad codes count against the per-IP limit), non-consuming code check, duplicate email, then one transaction: insert the user, then `UPDATE invite_codes SET used_at, used_by_user_id WHERE code_hash=:h AND used_at IS NULL AND expires_at > :now RETURNING id`. If no row comes back the user is rolled back and the generic error returned. One code makes one user even under concurrent signups; a race test with threads fails when the `used_at IS NULL` guard is removed.
- **Code checked before the duplicate email:** whether an email exists is now visible only to people holding a valid code (the leak noted in the rate-limit decision shrinks to code holders; email verification is still the full fix). A failed signup of any kind (duplicate email, 422, anything) leaves the code unused.
- **One generic error:** unknown, expired, used, malformed (including I, L, O, U) and over-length codes all return `400 {"detail": "Invalid or expired invite code."}` with identical headers, so a client cannot tell them apart. `invite_code` has no schema `max_length`: pydantic would answer 422 and reveal the length rule.
- **`used_by_user_id` is `ON DELETE SET NULL`:** deleting an account (M10) never fails on a used code, and the code stays used.
- **Accepted trade-off:** codes have 60 bits of entropy and are stored as plain SHA-256 (no salt, no slow hash). Someone holding a leaked database could in theory brute-force unused, unexpired codes offline, at very high cost. Expiry and single use bound the damage, so 12 characters is accepted.
- **Alternative:** a single invite code in an env var (no per-person revocation or expiry, reusable once leaked); an admin endpoint (needs admin auth); longer codes or a slow hash (worse to type, slower, and not worth it for this threat).

---

# Decision: Invite codes accept Crockford aliases and reject non-ASCII

- **Date:** 2026-11-03
- **Decision:** This changes "Input is normalized" and "malformed (including I, L, O, U)" in "Invite-code signup". `normalize()` now rejects any non-ASCII input first, then uppercases, drops dashes and whitespace, maps O to 0 and I/L to 1 (Crockford decoding), and strips the `TLN` prefix only when the cleaned input is exactly 15 characters. U is still malformed.
- **Why aliases:** codes are read off a screen or a note and retyped. Rejecting O for 0 gives the user the generic 400 with no hint, and each retry counts against the 5/hour signup limit, so a valid code could lock its holder out. Accepting the aliases costs no entropy: each maps to one canonical character and the same hash.
- **Why the length rule for the prefix:** L now maps to 1, so `TLN` and `T1N` look the same after mapping, and a body can start with `T1N`. Stripping a `T1N` start only from 15-character input keeps a 12-character body that starts with it intact.
- **Why ASCII only:** `str.upper()` maps some non-ASCII characters into the alphabet (U+017F long s becomes S), so a non-canonical string was accepted as a valid code. No security impact (same hash), but the format rule was not enforced. Non-ASCII whitespace (no-break space) is now rejected too; codes come from the CLI as plain ASCII.
- **Alternative:** keep strict decoding (simpler, hostile to typos); NFKC-normalize instead of rejecting (accepts more lookalikes, which is the opposite of the goal).

---

# Decision: Account deletion, session cookie flags, Origin check (M10)

- **Date:** 2026-11-03
- **Hard delete:** `POST /api/v1/account/delete` removes the user, their applications, interviews and sessions for good. Right-to-erasure style (the applicable law is the Philippine Data Privacy Act): a soft delete would keep personal data we have no reason to hold, there is nothing to restore, and the data is one user table plus rows that cascade from it. No email is sent.
- **POST, not DELETE:** some proxies and clients drop or reject a body on DELETE, and this call must carry the password.
- **403, not 401, for a wrong password:** the frontend treats 401 as "session expired" and sends the user to login. A wrong password on a live session is "forbidden", not "not authenticated". Same bcrypt path as login (`verify_password`; over 72 bytes or empty is just a wrong password, no 500).
- **Rate limit:** `account-delete:user:<id>` (5 / 15 min) and `account-delete:ip:<ip>` (10 / 15 min), via `enforce()`, committed before bcrypt (record-before-verify, like login). On success the user's rows are deleted with the account, so a correct password leaves nothing in the user budget; the IP row stays, like login.
- **One transaction, locked:** `SELECT ... FOR UPDATE` on the user row, then one `DELETE FROM users`. Applications, interviews and sessions go through FK cascades (no per-row deletes). Two simultaneous deletes: the loser waits for the lock, finds no row and gets 401. Without the lock it would match zero rows and answer 204 for an account it did not delete (test: `test_delete_waiting_on_a_concurrent_delete_gets_401_not_204`).
- **`sessions.user_id` ON DELETE CASCADE (migration `d4e8a2c61f07`, plus index):** it was the only FK to `users` with no action. The database removing sessions with the user means a login racing a delete cannot leave an orphan row; the login's session insert fails its FK check once the delete commits, and `/login` answers the generic 401 instead of a 500. `invite_codes.used_by_user_id` is already `SET NULL`: the code stays used.
- **Email rate-limit rows are deleted on erasure:** `login:email:<sha256>` keys are derived from the email, so they are personal data. They are removed in the same transaction. Rows keyed by IP stay (not tied to an account).
- **Re-signup:** the same email may sign up again after deletion, but only with a new invite code; the old code stays spent. The old account stays deleted even if the person gets a new code.
- **Cookie flags:** one helper (`app/auth/cookies.py`): HttpOnly, SameSite=Lax, Path=/, no Domain, Secure from `COOKIE_SECURE` (default true), Max-Age = session lifetime (30 days). With Secure on the name is `__Host-session_token`, a prefix browsers accept only with Secure, Path=/ and no Domain, so a sibling subdomain cannot plant or overwrite it. Without Secure the plain name `session_token` is used (local http). Logout and account deletion clear with identical attributes. `SameSite=None` is used nowhere. Changing the name logs everyone out once; nothing was deployed yet.
- **Next.js proxy, not SameSite=None to onrender.com:** the frontend (Vercel) proxies API calls through Next.js rewrites, so the browser only talks to the Vercel origin and the cookie is first-party there. Calling the Render API directly would make it a third-party cookie, which needs `SameSite=None; Secure`, is blocked or partitioned by Safari, Firefox and increasingly Chrome, and removes the Lax protection against CSRF. Rejected on both counts.
- **Origin rule (all of POST/PUT/PATCH/DELETE, login and signup included):** `Sec-Fetch-Site: cross-site` is 403; an `Origin` header not in `ALLOWED_ORIGINS` is 403 (including the literal `null`); safe methods are never checked. `ALLOWED_ORIGINS` is a comma list (default `http://localhost:3000`); entries are trimmed, lowercased, lose a trailing slash, blanks are dropped; a wildcard fails startup. No CORS middleware exists or is added.
- **Missing Origin is allowed:** browsers always send Origin on a cross-origin POST, so a request without it is curl, a script or a server-to-server call. Those do not carry a victim's ambient cookie, so there is nothing to forge. Requiring Origin would break tests and tooling and add no protection. SameSite=Lax on the cookie is the second layer.
- **Alternative:** a CSRF token (needs state and frontend work, more than a personal tracker warrants); soft delete with a purge job (keeps data longer, needs a scheduler); explicit `DELETE FROM sessions` instead of the cascade (an orphan or FK error is possible under a concurrent login).

---

# Decision: PR #17 review fixes (Origin check, config parsing)

- **Date:** 2026-11-03
- **Sec-Fetch-Site: same-origin skips the allow-list:** this changes the M10 "Origin rule". The Swagger UI at `/docs` is served by the API, so its POSTs carry the API's own Origin (`http://localhost:8000`), which is not in `ALLOWED_ORIGINS`; every write from `/docs` got 403. `same-origin` is set by the browser (a page cannot forge it), and it means the request came from the API's own origin, which is trusted by definition. `cross-site` is still 403; `same-site`, `none` or no header still go through the Origin allow-list. Alternative: add the API's own origin to `ALLOWED_ORIGINS` (has to be kept in sync per environment, and the API does not know its public origin behind a proxy).
- **ALLOWED_ORIGINS entries are validated at startup:** each must be `scheme://host[:port]` with scheme http or https and no path, query, fragment or user info (a trailing `/` is tolerated). Entries are lowercased and the default port is dropped (`https://x.com:443` becomes `https://x.com`), because browsers omit it in `Origin`. A bad entry fails startup naming `ALLOWED_ORIGINS` and the entry. Reason: `talaan.vercel.app` (no scheme) or `https://x.com/app` never matched any Origin, so every browser write got 403 in production with nothing logged.

---

# Decision: F4 frontend auth wiring

- **Date:** 2026-11-03
- **Next rewrites, not route handlers:** `next.config.ts` rewrites `/api/:path*` to `${BACKEND_URL}/api/:path*` (default `http://localhost:8000`; set `BACKEND_URL` in Vercel at deploy, it is read at build time). The browser only talks to the Next origin, so the session cookie is first-party and there is no CORS. Checked locally with an echo backend: `Set-Cookie` reaches the browser as HttpOnly, SameSite=Lax, Path=/, host-only and is invisible to `document.cookie`; the backend sees `Origin: http://localhost:3000`, `Sec-Fetch-Site: same-origin`, the `Cookie` header and `X-Forwarded-Host`, and no `X-Forwarded-For`. With the real backend a hostile `Origin` or `Sec-Fetch-Site: cross-site` through the rewrite is 403. Alternative: route handlers doing server-side `fetch` (no `Origin` reaches the API, so SameSite=Lax would be the only CSRF layer, and every endpoint needs a handler). Consequence recorded in ROADMAP as an M11 blocker: the API sees one client IP behind the rewrite.
- **`proxy.ts`, optimistic and never redirecting away from `/login`:** Next 16 renamed `middleware.ts` to `proxy.ts` (checked in the installed docs). It only tests that a cookie named `session_token` or `__Host-session_token` exists on a private path (else 307 to `/login?next=<path>`). It does not validate the cookie: that needs a DB round trip and the API is the authority. A stale cookie therefore passes the proxy, the first API call answers 401, and the fetch wrapper sends the user to `/login?expired=1&next=...`. The proxy never redirects `/login` or `/api/*` and the login page treats a `/me` 401 as "show the form"; if the proxy sent users from `/login` to the app on cookie presence, a stale cookie would loop `/login` <-> `/applications`. Alternative: validate in the proxy (slow, couples it to the DB). The installed testing helper is still named `unstable_doesMiddlewareMatch`.
- **401 handling in one place:** `request()` (`src/lib/http.ts`) sends a 401 to `/login?expired=1&next=<path+search>` unless `redirectOn401: false` (login, signup, logout, and the login page's own `/me` probe, where a 401 is an answer). The redirect promise never settles so the caller does not flash an error while the page is replaced. It does nothing on `/login` (no loop). Mock `api.ts` calls are untouched until F5.
- **`next` validation:** `safeNext()` accepts only a same-origin relative path: one leading `/`, not `//`, no backslash anywhere, no control characters, resolves to the same origin, and is not `/login...`. Anything else becomes `/applications`. Used by the login success path and the login-page probe. Alternative: an allow-list of routes (breaks when routes are added).
- **Sign-up logs in itself:** the API's `/signup` sets no cookie, so after a 200 the form calls `/login` with the same credentials. The password lives only in the submit handler's locals for those two calls. If that login fails, the form switches to Log in with the email kept and the notice "Account created. Log in to continue.". Error mapping is per field (invite 400 on the invite field, "Email already exists." on email, 422 per field); this amends DESIGN 8.1, which asked for one generic banner (the API already reveals email existence only to invite-code holders, M9).
- **Delete flow:** two steps in one dialog: what is lost, then type the account email (trimmed, case-insensitive) plus the password. The destructive button needs both. 403 and 422 show "Incorrect password." on the password field and keep the dialog open (the password is cleared); 429, 503 and network errors show a banner in the dialog; 401 goes through the session-expired flow; 204 goes to `/login?deleted=1` with `router.replace` and `refresh`. Busy disables Cancel and the button and blocks Escape (existing `Dialog` busy semantics); a ref guard blocks a second submit. Logout does `router.replace('/login')` plus `refresh`, and the e2e script confirmed Back lands on `/login`.
- **No browser storage for auth:** no tokens or user data in localStorage or sessionStorage (the session cookie is HttpOnly); the account screen holds the user in component state only.
- **No new dependencies:** `fetch`, `URL` and React only (no axios, SWR, zod or MSW). Playwright scripts under `frontend/scripts/` are run by hand with Playwright resolved from `NODE_PATH`, not added to `package.json` or CI.

---

# Decision: F5 applications on the real API

- **Date:** 2026-11-03
- **Server-side status filter with Load more, not one fetch filtered on the client:** `GET /applications` pages at 20 by default and **at most 100** per request. Fetching once and filtering in the browser would silently cut off anyone past 100 rows and give wrong tabs and a wrong empty versus no-match answer. So each status tab is its own request (`?status=<tab>&limit=50&offset=N`), `total` in the response decides "No applications yet." (All, total 0) against "No applications with this status." (a tab, total 0), and a "Load more" button appends the next 50 (hidden once `items.length >= total`, de-duplicated by id). This also removes the old second request that learned the overall total. Alternative: loop over pages up front and filter locally (instant tabs, but N requests on load and the same cap problem at any cap); rejected.
- **Cache and stale-while-revalidate:** an in-memory per-tab list cache (module state, never web storage). A cached tab shows at once while page 1 is refetched; the fresh page 1 replaces the entry, so pages the user had loaded are dropped (their offsets may have shifted). Limit: a row deleted elsewhere while the user paged can make Load more skip one row until the next refetch. Every create, edit and delete clears all tabs and the detail cache (the `api.ts` writes call `clearCaches()` themselves), and login, logout and account deletion clear it too, so one user's rows never reach the next user in the same tab. A response that lands after a clear is ignored.
- **Detail uses stale-while-revalidate:** a cached detail renders at once, Edit and Delete are disabled and the pane is `aria-busy` until fresh data lands. A write clears the cache, so after an edit the user sees a skeleton, never the old fields. The application and its interviews are separate requests: a failed interviews fetch shows an inline error with Retry and does not hide the application; a 404 on the application (missing or someone else's) is the not-found view. Interviews are fetched with `limit=100`; above that the pane says "Showing the first 100 of N interviews." (paging them is not worth a control).
- **`contact_email` stays out of the UI:** the API accepts it, but it is not in DESIGN section 2. It is read into the type, never sent (create and PATCH bodies list their fields by name).
- **Native date input:** `<input type="date">` gives a `YYYY-MM-DD` string that is sent and shown without a `Date` round trip, so no timezone can move the day. The server fills today (Asia/Manila) for a non-saved row with no date, on PATCH too, so on those statuses a cleared date comes back as today; the form's helper says so.
- **Work mode has no default:** the API requires it and a guess would be saved silently, so create starts with nothing chosen and "Choose a work mode." appears on submit. Status still defaults to Saved.
- **Validation counts code points:** Pydantic counts code points, `String.length` counts UTF-16 units, so a 200-emoji name would be rejected by a naive client. Rules use `[...s].length`; `maxLength` on the inputs is 2x the limit (a cap on typing, not the rule).
- **No optimistic updates:** a save waits for the server, then shows a toast and navigates with `router.replace` (Back never returns to the form); a delete uses `replace` too, so Back never lands on a deleted id. Edit sends a PATCH with only the changed fields; no changes means no request and no toast.
- **Dirty guard limits:** Cancel and the app-bar back arrow ask "Discard changes?" only when dirty. The browser Back button and the side and bottom nav links are not intercepted (client-side navigation gives no reliable hook in the App Router); a `beforeunload` handler, registered only while dirty and removed on save and unmount, covers reload and tab close. A 401 mid-form goes to `/login?expired=1&next=...` and the unsaved edits are lost; after login the form reopens pre-filled from the server.
- **Local scripts:** `frontend/scripts/{e2e,seed,screens}-applications.cjs` share `local-env.cjs`, which starts the API on the test database and `next dev` on free ports (never :8000 if busy), and on exit stops them, truncates the test database and prints that the dev database and a foreign :8000 process were not touched. Not in `package.json` or CI.

---

# Decision: F5 review fixes (cache version, Load more offset, write responses, 401 unload)

- **Date:** 2026-11-04
- **Supersedes:** the last sentence of the 2026-11-03 F5 cache bullet ("A response that lands after a clear is ignored"), which held for the list only. The detail had no such check, so a detail fetch in flight during a write could put pre-write data back in the cache.
- **Cache version:** `cache.ts` keeps a counter that `clearCaches()` bumps. Every list and detail request records `cacheVersion()` when it starts, and its response is neither stored nor applied if the version has changed by then. The effect's `live` flag alone is not enough: a response can land after the clear but before React re-renders and runs the cleanup. The detail also subscribes to `onCachesCleared`: it drops both results and refetches, so the cache-store effect never pairs an old application with new interviews.
- **404 evicts:** a 404 on the application or on its interviews removes that id from the detail cache (`dropDetail`), so a revisit shows the skeleton, not the deleted record.
- **Load more offset:** the list entry stores `nextOffset` = server offset + rows the server sent, not the de-duplicated `items.length`, and Load more shows while `nextOffset < total`. A page that adds no new row means the offsets shifted: Load more is withdrawn and page 1 is refetched, which replaces the entry. The 2026-11-03 limit still holds: a row deleted elsewhere can make Load more skip one row until the next refetch.
- **Write responses:** `createApplication` and `updateApplication` clear the caches as soon as the request succeeds and resolve to the row's id only (create reads `id` through `mappers.idOf`). A full mapping of a write response could fail after the server committed (a status this client does not know yet), and the form's "Try again" would then create a duplicate. The detail refetches and maps the row anyway. Alternative: map first and clear in `finally` (still an error banner on a saved row); rejected.
- **401 during unload:** `request()` sets a module-level "leaving" flag (`isLeavingForLogin`) before the 401 redirect, cleared on `pageshow` (bfcache restore). The form's `beforeunload` handler does not prompt while it is set, because "Stay" would cancel the redirect and leave the form on a save that never settles.

---

# Decision: F6 interviews (Philippine time, routes, no status automation)

- **Date:** 2026-11-04
- **Times are Philippine time only.** The input is a native `datetime-local`, labelled "Philippine time", always read as Asia/Manila (UTC+08:00, no DST), sent as `YYYY-MM-DDTHH:mm:00+08:00` and shown as PHT everywhere. Why: Talaan is for Philippine job seekers, and the alternative (the browser's zone) makes the same interview read differently on a laptop with a VPN, on a trip, or after a zone change; the API stores an instant, so nothing is lost by pinning the wall clock. `src/lib/pht.ts` uses only UTC getters and string rebuilding (never local getters, never `Date` parsing of a zone-less string); its tests switch `process.env.TZ` and CI also runs the whole frontend suite under `America/Los_Angeles`. Limit: someone interviewing in another zone has to convert by hand. Alternative: a zone selector per interview; rejected as scope nobody asked for.
- **Edit compares like with like.** The edit form builds its baseline from its own form values (API value shown as PHT, rebuilt with +08:00), so a UTC value with seconds, or notes with padding, never looks changed and is never sent. Only changed fields go in the PATCH; none changed means no request and no toast.
- **No automatic status change.** Saving an interview does not touch the application's status (a user may log a past interview on a `saved` row, or keep `applied` after a screening). Moving the status stays an explicit edit. Alternative: bump to `interviewing` on the first interview; rejected, a silent write the user did not ask for.
- **Routes, not a dialog.** `/applications/[id]/interviews/new` and `.../[interviewId]/edit` are full-screen forms in the app shell, the same shape as the application form (same dirty guard, 401 handling, `router.replace` back to the application so Back never returns to the form). This supersedes DESIGN 8.5's "dialog on tablet and desktop". Reason: one pattern, refresh and deep links work, `beforeunload` and the 401 `next=` already handle routes. The delete stays a confirm dialog.
- **Mode has no default.** The API requires it and a guess would be saved silently, so create starts with nothing chosen ("Choose an interview mode."), like the work mode in F5. Outcome defaults to Pending, the backend default; it is never null.
- **The backend's PATCH and DELETE are flat** (`/interviews/{id}`; only create and list are nested), so `updateInterview(id, initial, next)` and `deleteInterview(id)` take the interview id only. The edit page rejects an interview whose `job_application_id` is not the route's application (shown as not found).
- **Writes clear the caches first.** As in F5, every interview write calls `clearCaches()` as soon as the server accepted it, before the response is mapped, and resolves to the id only. A 404 on update or create also clears (something is gone elsewhere); a 404 on delete is success.
- **The F5 rule still holds: a cache clear means the skeleton, then fresh data**, so after an application or interview edit (a separate route, so a remount) the detail never shows pre-edit fields. The one exception is an interview deleted in place on the detail: the hook holds the page it is showing, drops the deleted row at once (and lowers the total) and refetches in the background, so the page neither blanks nor flashes "not found". The held copy lives in hook state only: it is dropped on an id change and on unmount, and when the DELETE fails.
- **Shared pieces:** `TextAction` is the one 44px text action (bar, xl detail header, interview rows; replaces `xlAction` and the duplicate in `BarAction`), `useLeaveGuard` the one `beforeunload` guard, `mapServerErrors` takes its field list as a parameter.
- **Local scripts:** `frontend/scripts/{e2e,screens}-interviews.cjs` on the same `local-env.cjs`; the e2e re-checks displayed and prefilled times in `America/Los_Angeles` and `Pacific/Auckland` browser contexts and watches for a "not found" flash around interview writes. Not in CI.

---

# Decision: interview delete keeps the page through the detail cache (supersedes part of F6)

- **Date:** 2026-11-09
- **Supersedes** the F6 bullet "The F5 rule still holds ..." on how an in-place interview delete keeps the page. The rule itself stays: a cache clear means the skeleton, then fresh data, and the in-place delete is still the one exception.
- **Decision:** after a confirmed interview delete (204, or 404 = already gone), the detail writes the page it shows, minus the deleted row and with the total lowered by one, into the detail cache with `setDetail`. The clear inside `deleteInterview` has already queued the refetch, so the first render after the clear takes the normal cached path (`refreshing: true`, Edit and Delete disabled) and the refetch replaces it. The held-copy machinery in `use-detail.ts` (`kept`, `holding`, `sawClear`, `latest`, `holdForInterviewDelete`, `dropInterview`, `releaseHold`) is gone.
- **Why it works:** the clear's state resets render in a later scheduler task; the code after `await deleteInterview(...)` runs in a microtask before that, so the cache already holds the post-delete page when React renders. The tests that guard this (row gone at once, no skeleton, no "not found", refetch still made) pass unchanged, and the local e2e watches the detail pane for a skeleton from the delete click on.
- **What changed in behavior:** only one corner. The held copy lived in hook state, so leaving the page before the refetch landed dropped it. The cached copy survives until the next clear or the refetch, so a revisit in that window shows the post-delete page at once (stale-while-revalidate) instead of the skeleton. It is never pre-write data: it is the server's state after the delete.
- **Alternative:** keep the held copy (about 50 more lines across the hook, the context and the detail, kept in sync by hand); rejected after code review item 6.

---

# Decision: interview edit baseline and year check (F6 review fixes)

- **Date:** 2026-11-09
- **Edit baseline from the server record.** Amends the F6 bullet "Edit compares like with like": the baseline is still in the form's own shape (PHT rebuilt with +08:00, trimmed), but it is built once from the server record (`toInterviewInput`, like `toApplicationInput`). A stored time the PHT input cannot show makes the edit page say "Couldn't load this interview." instead of opening a form that would fail on Save. A conversion error at submit shows the save banner; Save never does nothing.
- **Year check only on a changed time.** The API checks 1900-2200 in the offset it was sent in, so a stored instant can read as 2201 or 1899 in PHT. The form checks the year only when the time differs from the value it opened with, so such a row stays editable (a Notes-only edit sends only the notes). Create always checks. Alternative: clamp or rewrite the stored time; rejected, a silent change to data the user did not touch.

---

# Decision: client IP behind the Vercel rewrite (shared secret header)

- **Date:** 2026-11-09
- **Problem.** The browser reaches the API only through Vercel's `/api/*` rewrite, so the API's socket peer is always Vercel and the per-IP login and signup limits became ONE bucket for everyone. Resolves the 2026-11-03 (F4) blocker; option (a) there.
- **What Vercel forwards (docs, not yet captured on a live deploy).** For an external rewrite Vercel sends `x-real-ip` and `x-forwarded-for` (the visitor's public IP, overwritten so a client cannot forge them), plus `x-forwarded-host` and `x-forwarded-proto`. Sources: vercel.com/docs/headers/request-headers and vercel.com/docs/routing/rewrites. Render then puts Cloudflare and its load balancer in between; its docs do not say whether it appends to or replaces an incoming `X-Forwarded-For`. So the right-most XFF hop on Render is most likely a shared Vercel egress address, and any left-hand value is attacker-controlled when the `onrender.com` URL is called directly. Not usable as the limiter key.
- **Chosen.** `frontend/src/proxy.ts` performs the `/api` rewrite itself (`NextResponse.rewrite` with `request.headers`; `next.config` `rewrites()` cannot add request headers, so that block is removed). With `PROXY_SECRET` set it adds `X-Talaan-Client-IP` (from `x-real-ip`) and `X-Talaan-Proxy-Secret`, and it ALWAYS deletes client-sent copies of both. The API (`rate_limit._proxy_header_ip`) trusts the IP header only when `PROXY_SECRET` is configured and the request carries exactly one secret header that matches (`hmac.compare_digest`) and exactly one parseable IP value; otherwise it ignores both headers and falls back, never raising. IPv6 is still bucketed to /64. `PROXY_SECRET` must be at least 32 characters (`openssl rand -hex 32`).
- **TRUST_PROXY stays, unchanged.** Precedence: valid secret header, then `TRUST_PROXY` (right-most XFF), then the socket. Production sets `PROXY_SECRET` and `TRUST_PROXY=false`. Direct callers of the Render URL carry no secret and share the load-balancer socket bucket; that bucket is separate from every real user's, so they cannot lock Vercel users out. Alternatives rejected: (b) looser per-IP limits (weakens the limits for everyone), (c) another host (not free).
- **Proxy on every `/api` request, on purpose** (code review of PR #21, item 8, rejected). The matcher sends all of `/api` through `proxy.ts`, not only login, signup and account delete. That gives one owner for forwarding: a narrowed matcher plus `rewrites()` for the rest would quietly put a future rate-limited endpoint in the shared Vercel bucket. Cost: one proxy invocation per API call (latency, Vercel usage), accepted. Check Vercel usage once after the first week (docs/DEPLOY.md).
- **Limit.** Anyone who learns the secret can name any IP. It lives only in Render and Vercel env vars; rotate by changing both. It is not an origin lock: the API still answers requests that skip Vercel (backlog line in ROADMAP).
- **Evidence.** Local check through `next dev` to an echo backend: the secret and `x-real-ip` arrive as `X-Talaan-Client-IP` and `X-Talaan-Proxy-Secret`; spoofed copies are replaced (with the secret) or removed (without it). The real Vercel and Render header shapes still have to be confirmed in the F7 smoke test.

---

# Decision: production mode (docs off, refuse insecure config)

- **Date:** 2026-11-09
- `ENVIRONMENT` is `development` (default, also blank) or `production`; anything else fails startup. Production turns off `/docs`, `/redoc` and `/openapi.json` (the Origin check trusts `Sec-Fetch-Site: same-origin`, so Swagger on the API origin could call every write route).
- `app/main.py` refuses to import in production if `config.production_problems()` is not empty, and lists every problem at once: `COOKIE_SECURE` not true, `BCRYPT_ROUNDS` below 12 (it only warned before), `PROXY_SECRET` missing, `ALLOWED_ORIGINS` unset or blank, or listing a local (`localhost`, `*.localhost`, or any loopback or unspecified IP checked with `ipaddress`: `127.0.0.0/8`, `0.0.0.0`, `[::1]`, `[::]`, and their IPv4-mapped IPv6 forms) or non-https origin. The check reads the parsed `ALLOWED_ORIGINS` (the same list the Origin check uses); equal to the local default means unset.
- The check is in `main.py`, not at config import, so `python -m app.admin` and `alembic` still work with only `DATABASE_URL` (the purge workflow and the migration step need that). Alternative: validate at config import; rejected for that reason.

---

# Decision: purge job (admin CLI, GitHub Actions)

- **Date:** 2026-11-09
- `python -m app.admin purge` deletes `rate_limit_events` older than a fixed 7 days (`config.MAX_WINDOW_SECONDS`) and sessions with `expires_at <= now`. This resolves the M11 blocker: both tables were only pruned when the same key or token came back.
- **Fixed cutoff, not the API's windows.** The workflow runs with only `DATABASE_URL`, so a cutoff computed from its own `*_WINDOW_SECONDS` would use the defaults (1 hour) while Render may run longer windows, and purge would delete events the limiter still counts. Instead config refuses any `*_WINDOW_SECONDS` above 7 days at startup (every environment), and purge always keeps 7 days. Alternative: pass the windows to the workflow too; rejected, two copies of the same settings drift.
- **Beside the API.** `DELETE ... WHERE id IN (SELECT ... ORDER BY id LIMIT 1000 FOR UPDATE SKIP LOCKED)`, one commit per batch, until a batch is short. No table or advisory locks. Purge itself never waits: a row another transaction holds is left for the next run, and a test (a second connection holds a row) fails if `SKIP LOCKED` is removed. The API can wait briefly: a write to a row the current batch holds (the limiter pruning an old event while it holds its advisory lock, a logout or `get_current_user` deleting an expired session) blocks until that batch commits. Each batch is a sequential scan because the cutoff columns have no index, so the wait grows with table size; at this scale it is milliseconds, once a day. Rows older than every window cannot change a limiter count.
- **Invite codes are not purged.** They are created by hand (tiny volume), `list-invites` shows expired and used codes as history, and a used row records which user took the code. Deleting them saves nothing and loses that trail.
- **Scheduling.** `.github/workflows/purge.yml`: daily at 03:17 Manila plus manual dispatch, using the `DATABASE_URL` repository secret (Neon's direct, unpooled string). Cutoff columns have no index, so a batch scans the table; add one if it ever gets slow (`ponytail:` comment in `app/admin.py`).

---

# Decision: P1 polish (status select, status change, logo link, slow start, cache scope)

- **Date:** 2026-11-09
- **Select over tabs.** Ten tabs scrolled sideways on a phone and hid the active one. One native select (the 6.2 component) is reachable by keyboard and touch without custom code. Alternative: keep tabs and add a "more" menu; rejected, two controls for one job.
- **Status change = radio group plus a confirm button, not one tap.** Arrow keys move native radios, so one tap per status would PATCH on every key press for keyboard users. Alternative: one tap on a list of buttons; viable for touch only.
- **F5 cache rule still holds: only data the server sent after the write is cached, never what the client assumed.** The in-place status change is a second exception beside the interview delete (2026-11-09, "interview delete keeps the page through the detail cache"): right after the PATCH succeeds (caches cleared first, as for every write) the detail cache gets the application the server returned, so the page shows the new status and any `date_applied` the server filled in without a skeleton; the background refetch then replaces it. The PATCH sends `{status}` only, never a date. A response that cannot be mapped falls back to the normal skeleton and refetch; a failed PATCH writes nothing. The interviews part of the entry is the page already on screen (a status change cannot alter interviews).
- **Cache writes are atomic.** Each cache operation (`clearCaches`, `clearDetail`, `replaceDetail`, `storeApplication`) sets the new state and then notifies its listeners in one synchronous call, so the first render after a write already sees the replacement. The first P1 version wrote the replacement from the screen after an `await`, which worked only because that continuation ran before React's render (PR #23 review).
- **Waking-up line on the applications screen: first load only.** It shows only while nothing has loaded in this tab yet (`loadedOnce`), never for a reload after a cache clear, when the API is plainly awake. From 1280 it sits inside the h-dvh list pane so it never makes the page scroll; below 1280 it stays above the screen.
- **Interview writes clear only that application's detail cache.** An interview write changes no list field, and the list is ordered by `created_at`, so the list cache stays valid and the list pane no longer flashes a skeleton. Login, logout, account deletion and every application write still clear everything; an interview write that gets a 404 also clears everything (the application may be gone). Alternative: keep the global clear; that was the skeleton flash in the backlog.
- **Waking-up line after 3 seconds.** The free-tier API measured 19 s cold. A line under 3 s would flash on every normal load. Threshold is a constant, not an env setting.
- **Logo links to `/applications`** (filter cleared), not to `/`, which only redirects. Not a link on the login band, where there is nowhere to go.
- **Design doc corrected to v2.3:** 7 said the application form is a dialog on tablet and desktop; it has always been a full-screen route.

---

# Decision: status change patches every cache under a list epoch (supersedes a P1 bullet)

- **Date:** 2026-11-10
- **Supersedes** the 2026-11-09 P1 bullet "F5 cache rule still holds" on the status change. That bullet says the caches are cleared first and a background refetch replaces the detail. The code no longer does that: since the first PR #23 review, a status change clears nothing and writes the server's row into every cache (`storeApplication`). The old bullet stays as written because this log is append-only; this entry is the current rule.
- **Patch in place, no refetch.** The PATCH response is the server's row after the write, and a status cannot change interviews, so the detail takes the row as fresh data. Every cached list is patched (the order, `created_at desc, id desc`, never depends on status). At 1280 the list pane keeps its rows, its Load more pages and its scroll. Alternative: clear and refetch; rejected, because a list refetch replaces the entry with page 1, which drops the loaded pages and the scroll, and costs a request on a possibly cold backend. The F5 rule still holds: only data the server sent after the write is cached.
- **`patchList` is derived from each list's own rows, and drops instead of guessing** (review round 2, findings 2 and 4). A status list that holds the row under another status loses it (`total` and `nextOffset` - 1), whatever the screen's `from` says (another tab may have moved it). The new status's list replaces a held row, and inserts a new one only inside the held rows or into a complete list. When the row would sit beyond the cursor of an incomplete list (new status, or `from` not holding it), the list is dropped and refetched: whether the server's `total` already counts the row cannot be known. Applying the same patch twice changes nothing.
- **List epoch and status-write window** (review round 2, findings 1, 2, 3, 6). One counter, `listEpoch`, is bumped by `clearCaches`, `storeApplication` and `beginMove`. A count of status writes in flight goes up in `beginMove` before the PATCH and down in `endMove` in its `finally`. A list response is stored only when its stamp is unchanged and no status write is in flight (`listFresh`). Otherwise it waits for `listsSettled()` and is asked again: page 1 restarts; Load more retries once from the patched cursor and then offers the button again. It is never dropped silently. The window matters because a page the server answered after the commit can land before the PATCH response, and `patchList` would then apply the change to it twice. One epoch, not one per list: only one list hook is mounted, and a filter not cached yet has no entry to bump. Cost: an unrelated list request in flight is re-issued too. A list dropped while on screen refetches at once. Rows are read only from the cache.
- **A status PATCH times out after 60 s** (`STATUS_TIMEOUT_MS`; `request()` takes a `signal`). Without a bound, a PATCH that never answers would hold the window open until a reload. The measured cold start is 19 s. No answer (timeout or network error) clears every cache, since the server may have committed.
- **The detail guards its application request with a hook-local counter, not `detailStamp`** (finding 7). A status change of the open id bumps it, so an application GET that started earlier cannot replace the server's new row. `detailStamp` would also drop a valid interviews request in flight, and nothing would re-issue it. The StatusDialog stays open while the detail refreshes, so a refresh during the PATCH no longer closes a busy dialog. The Change status button is still disabled while refreshing.
- **`changeStatus` resolves to nothing.** The caches are the result; the returned row was never read.
- **Correction (2026-11-10, review round 3, finding 6).** The `patchList` bullet above says "Applying the same patch twice changes nothing". That is wrong: `patchList` is not idempotent. A second application of the same patch drops an incomplete list of the old status, because the row is no longer held and may sit beyond the cursor. The list epoch (`listFresh`/`listStamp`) is what prevents a double patch. Pinned by a test in `tests/cache.test.ts`.
- **Update (2026-11-10, review round 3, finding 7).** `beginMove` no longer bumps `listEpoch`; only `clearCaches` and `storeApplication` do. A page landing during the PATCH is still refused by the in-flight count, and success and no answer still move the epoch. A PATCH that fails with a 4xx or 500 changed nothing, so a list page sent before it is stored as is instead of being re-issued. `moveState()` is no longer exported; tests observe the window through `listsSettled()`.
- **Update (2026-11-10, review round 3).** No answer for a status PATCH now also covers a gateway 502, 503 or 504 (the proxy gave up; the backend may still commit): every cache is cleared. A 2xx whose body read the timeout cut off (`ApiError.httpOk`) counts as saved: caches cleared, "Status updated.". Login, logout and account deletion call `resetCaches()`, which also ends every status window (a PATCH answered 401 never settles, so its `endMove` never runs); plain `clearCaches()` leaves the window alone so an overlapping PATCH keeps it. Deferred to the ROADMAP backlog: findings 1, 3 and 9.

---

# Decision: F8 interviews agenda, .ics download and import guide

- **Date:** 2026-11-11
- **Agenda first, no calendar grid.** The question a job seeker asks is "what is coming up", so the screen is a list grouped by Philippine day (Upcoming oldest first, Past newest first), not a month grid, which needs layout and a lot of empty cells for a handful of events. Alternative: a month view; left out on purpose (a grid is a later, optional view of the same endpoint).
- **A third navigation destination, `Interviews`,** not a tab inside Applications: the data is across applications and the deep link `/interviews` must work. DESIGN.md is v2.4 (sections 2, 6.5c, 6.6, 6.7, 6.8c, 7, 8 and the Don'ts). The 88px rail fits three items (checked at 768 in `e2e-agenda.cjs`); the 2026-11-02 backlog worry was about a longer label.
- **`GET /api/v1/interviews?when=upcoming|past`**, same page shape as `GET /applications`. `when` is required (no default), so a client cannot silently get the wrong half. Upcoming is `scheduled_at >= now`: an interview exactly at now is still upcoming. Ties break on `id` in the same direction as the time, so paging is stable. Items carry the existing names `job_application_id`, `company` and `job_name` (not `application_id` and `job_title`): every other payload and `types.ts` already use them and a second id field would be redundant.
- **No migration.** The query filters on `job_applications.created_by` and joins on `interviews.job_application_id`, both indexed, and one user has few interviews. A global `interviews(scheduled_at)` index would not help a per-user filter; if one is ever needed it is `(job_application_id, scheduled_at)`. Production deploy order: nothing for Neon; the Render API with the new route should be live before or with the Vercel frontend (otherwise only the Interviews screen shows its error and Retry).
- **Agenda cache rule: clear it.** The agenda cache is dropped, and its version bumped, by `clearCaches()` and by `clearDetail()`/`replaceDetail()`, so every interview create, edit and delete, every application create, edit and delete, any 404 on a write, a status write with no answer, and every auth event (`resetCaches()`) leaves it correct. A status change keeps it: a row shows no status and a status change cannot alter the company, job title or interview fields. Alternative: patch the cached rows. Rejected: interview writes return only an id, and an edited time can move a row between Upcoming and Past or onto another page, so a patch needs the whole ordering logic for no visible gain. A response requested before a clear is dropped (`agendaVersion`), and the tab refetches.
- **The `.ics` is built in the browser** (`src/lib/ics.ts`, pure, no request, no dependency). One VEVENT; the start is the stored instant written in UTC (`Z`), so no VTIMEZONE is needed and it is the same moment in any calendar and device zone. **One hour is the default duration**: the app has no duration field and adding one is a schema change this milestone does not need. CRLF, folding at 75 octets between code points, escaping of backslash, semicolon, comma and newlines.
- **No notes in the file.** Notes are private and can be long; the description holds only the mode, the interviewer when present and a link to the application.
- **UID is `talaan-interview-<id>@talaan`,** a constant suffix and not the origin host (review of the F8 plan), so a later domain change does not break de-duplication when a file is imported again. Pressing "Add to calendar" twice gives two identical files and a calendar treats them as one event, so there is no guard.
- **A one-time copy, not a feed.** There is no subscription URL and no API token (out of scope). The import guide says so in its first line: if an interview changes in Talaan, download a new file and delete the old event first. A calendar does not update an imported file by itself.
- **The guide lists only steps that were checked** against the vendors' help pages on 2026-11-11: Google Calendar (computer only; the phone app cannot import files), Apple Calendar on a Mac, Outlook on the web and classic Outlook for Windows. Not listed because the vendor pages could not be verified: opening the file directly on an iPhone or an Android phone, and the new Outlook for Windows. Differences from the first draft for Google: the file must end in `.ics`, the menu item is spelled "Import & Export", and the destination calendar defaults to the main calendar.
- **Empty state:** a Secondary "Go to applications", no primary button (an interview is added from an application). The `?when=past` tab lives in the URL. The detail's back arrow still goes to `/applications` (see the ROADMAP backlog).

---

# Decision: F8 review round 1 (agenda as_of, guide, toast)

- **Date:** 2026-11-12
- **`as_of` pins the upcoming/past boundary across pages** (finding 1). `GET /interviews` paged with a plain offset over `scheduled_at >= now`, and now moves: an interview passing between page 1 and Load more shifted the offsets, so Upcoming skipped rows and Past repeated them. The endpoint now takes an optional `as_of` (ISO 8601 with an offset; pydantic `AwareDatetime`, so a naive or unparseable value is the standard 422) and echoes the instant it split at. Page 1 sends none and gets the server's now; every Load more of the same list sends page 1's `as_of` back; a tab switch or page-1 refetch starts again without it. Past uses the same `as_of`, so it no longer repeats rows either. The client builds the query with `URLSearchParams`, since a raw `+08:00` decodes to a space (that case is 422, never misread). Alternative: keyset (cursor) pagination on `(scheduled_at, id)`; rejected for now: it changes the page contract both clients share for one edge case that one extra parameter fixes, with no schema change and the same indexes. A row created or deleted between pages can still shift the offsets; the existing de-dup and the "no new row: refetch page 1" path cover that, as for applications.
- **Every visit to an agenda tab is a new request generation** (finding 3). A tab switch bumps the hook's tick, so `Upcoming -> Past -> Upcoming` never reuses a key and a response from an earlier visit is dropped. Load more's busy flag is per tab.
- **The import guide stays open when the last upcoming interview passes** (finding 4). Only its trigger follows "has an upcoming interview"; closing it after the trigger has gone moves focus to the Interviews heading.
- **The download toast says "Calendar file created."** (finding 7), not "downloaded": the page builds the file and clicks a download link but cannot know a file was saved (iOS Safari opens a calendar preview, and a browser can block the download). Supersedes the toast text in the 2026-11-11 F8 entry and DESIGN.md v2.4 6.6.
- **Guide steps re-checked 2026-11-12** (finding 6, not reproduced). Microsoft's classic Outlook page does end with "Select Open as New" (the file opens as another calendar under Other Calendars), so that step stays. Apple's File > Import ends with an Import button, which our step now names.
- **Deferred to the ROADMAP backlog:** finding 8 (SEQUENCE/LAST-MODIFIED), finding 9 (device clock on the detail vs server clock on the agenda) and the `use-agenda`/`use-list` consolidation (finding 10 got tests only).
