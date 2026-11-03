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
