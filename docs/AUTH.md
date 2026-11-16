# Talaan: Auth design decisions

Moved from CLAUDE.md on 2026-11-16. The every-session rules are repeated as one-liners in CLAUDE.md.

- **`BCRYPT_ROUNDS`** (`app/config.py`, default 12): cost for `hash_password` (read at call time) and for the login dummy hash (built once at startup), so they always match. `tests/conftest.py` sets 4; never lower it outside tests. **Must stay fixed after launch**: old hashes keep their cost, so a change reintroduces a timing gap between known and unknown emails (rehash-on-login is a possible future change; DECISIONS.md 2026-11-03).
- **Invite codes** (`app/auth/invites.py`, `app/admin.py`): signup requires `invite_code`. Format `TLN-XXXX-XXXX-XXXX` (12 Crockford base32 chars, 60 bits); input is normalized (non-ASCII rejected; strip, uppercase, drop dashes/whitespace, map O→0 and I/L→1, drop `TLN` only from 15-char input) then SHA-256 hashed. Single use, with expiry. Signup order: rate limit, non-consuming code check, duplicate email, then one transaction: insert user + atomic `UPDATE ... RETURNING` to consume (no row: roll back, same error). Every bad-code case is `400 {"detail": "Invalid or expired invite code."}`. No bypass flag, no admin endpoint; tests make codes with `create_invite` in `tests/conftest.py`. Never log or return a plaintext code except the one-time CLI print. DECISIONS.md 2026-11-03.
- **Rate limits** (`app/auth/rate_limit.py`, Postgres): login per IP and per email, signup per IP; limits from env (`.env.example`). Client IP: `X-Talaan-Client-IP` when `PROXY_SECRET` is set and `X-Talaan-Proxy-Secret` matches (constant-time; sent by `frontend/src/proxy.ts`, which strips client copies), else the socket peer; `TRUST_PROXY=true` uses the right-most `X-Forwarded-For` instead of the socket. `TRUST_PROXY` is the only trust switch (run uvicorn with `--no-proxy-headers`). Limiter DB error returns 503.
- **Session cookie** (`app/auth/cookies.py`, the only place name and attributes live): HttpOnly, SameSite=Lax, Path=/, no Domain, Max-Age = `SESSION_LIFETIME`, Secure from `COOKIE_SECURE` (default true). Secure on: name `__Host-session_token`; off: `session_token`. Never `SameSite=None`. **With `COOKIE_SECURE=true` (the default) a plain-http client such as curl or Safari will not send the cookie; set `COOKIE_SECURE=false` in your local `.env`.** Existing local sessions stop working once because the cookie name changes. Tests force `COOKIE_SECURE=false`; cookie tests patch `config.COOKIE_SECURE` and read the raw `Set-Cookie`.
- **Origin check** (`app/security.py`, middleware inside `no_store`): POST/PUT/PATCH/DELETE get 403 if `Sec-Fetch-Site` is `cross-site`; `same-origin` passes without the list (Swagger at `/docs`); otherwise 403 if `Origin` is present and not in `ALLOWED_ORIGINS` (default `http://localhost:3000`, parsed by `config.parse_origins`: each entry `http(s)://host[:port]`, lowercased, default port dropped; `*` or a malformed entry fails startup). No Origin = allowed (non-browser). No CORS middleware: the frontend proxies through Next.js. DECISIONS.md 2026-11-03.
- **Account deletion** (`POST /api/v1/account/delete`, `app/users/router.py`): hard delete, password required (wrong = 403, not 401), rate limited per user and IP (`ACCOUNT_DELETE_*`), `FOR UPDATE` on the user row then one `DELETE`; FK cascades remove applications, interviews and sessions; `invite_codes.used_by_user_id` goes NULL (code stays used); the user's `login:email:<hash>` rate rows are deleted. Same email can re-signup only with a new invite code.
- **Sessions over JWT**: instant revocation (delete the row); no horizontal-scaling need.
- **Session lifetime 30 days**: `SESSION_LIFETIME` in `app/auth/router.py`, used
  for both `expires_at` and cookie `max_age` (must stay in sync). Rationale in DECISIONS.md.
- **Passwords**: at least 8 characters and at most 72 UTF-8 bytes (bcrypt limit)
  + upper/lower/digit/special; enforced on `UserCreate` only, not `UserLogin`.
- **Login failures return 401** (never 404/400), the same 401 for wrong password
  and unknown email. `/login` returns `{"detail": "Logged in"}` and sets the cookie
  (no token in the body).
- **`/logout` is idempotent**: always 204 and clears the cookie, even for a missing or
  invalid token; deletes the session row if one exists (DECISIONS.md).
- **`get_current_user`** (`app/dependencies.py`): reads cookie, loads Session,
  401 if missing; 401 + deletes row if expired; returns `User`. `GET /me` uses it.
- All Job Application/Interview routes must scope to the caller via
  `get_current_user` (`created_by`; interviews via their parent application).

- **Production mode** (`app/config.py`, `app/main.py`): `ENVIRONMENT=production` hides `/docs`, `/redoc`, `/openapi.json` and refuses to start unless `production_problems()` is empty (`COOKIE_SECURE` true, `BCRYPT_ROUNDS` >= 12, `PROXY_SECRET` set, `ALLOWED_ORIGINS` set to non-local https origins). Checked in `main.py` only, so the admin CLI and alembic need just `DATABASE_URL`.
