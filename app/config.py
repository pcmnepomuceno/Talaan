"""Application configuration.

Reads settings from environment variables (loaded from a local .env file if
present). Keep real secrets in .env, never commit them — see .env.example.
"""

import logging
import os
from urllib.parse import urlsplit

from dotenv import load_dotenv

load_dotenv()

# Full SQLAlchemy connection string, e.g.
# postgresql+psycopg2://user:password@host:5432/dbname
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://talaan@localhost:5432/talaan",
)


def _int(name: str, default: int, minimum: int | None = None, maximum: int | None = None) -> int:
    raw = os.getenv(name) or default  # blank (`KEY=` in .env) means unset
    try:
        value = int(raw)
    except ValueError:
        raise ValueError(f"{name} must be an integer, got {raw!r}") from None
    if minimum is not None and value < minimum:
        raise ValueError(f"{name} must be >= {minimum}, got {value}")
    if maximum is not None and value > maximum:
        raise ValueError(f"{name} must be <= {maximum}, got {value}")
    return value


# bcrypt cost for new password hashes and the login dummy hash. Read at call time by
# hash_password; the dummy hash is built once at startup with the same value.
DEFAULT_BCRYPT_ROUNDS = 12
# 4..31 is bcrypt's own range; below the default is only for tests.
BCRYPT_ROUNDS = _int("BCRYPT_ROUNDS", DEFAULT_BCRYPT_ROUNDS, minimum=4, maximum=31)
if BCRYPT_ROUNDS < DEFAULT_BCRYPT_ROUNDS:
    logging.getLogger(__name__).warning(
        "BCRYPT_ROUNDS=%d is below %d: weak password hashes. Use it only in tests.",
        BCRYPT_ROUNDS,
        DEFAULT_BCRYPT_ROUNDS,
    )

# Rate limiting (app/auth/rate_limit.py). Read at call time, so tests can patch these.
# Each must be >= 1: a 0 limit would crash the limiter (500 on every login), not disable it.
# Every *_WINDOW_SECONDS is capped at MAX_WINDOW_SECONDS: `python -m app.admin purge` deletes events
# older than that without seeing the API's env, so a longer window would silently count too few.
MAX_WINDOW_SECONDS = 7 * 24 * 3600
LOGIN_IP_LIMIT = _int("LOGIN_IP_LIMIT", 10, minimum=1)
LOGIN_IP_WINDOW_SECONDS = _int("LOGIN_IP_WINDOW_SECONDS", 900, minimum=1, maximum=MAX_WINDOW_SECONDS)
LOGIN_EMAIL_LIMIT = _int("LOGIN_EMAIL_LIMIT", 5, minimum=1)
LOGIN_EMAIL_WINDOW_SECONDS = _int("LOGIN_EMAIL_WINDOW_SECONDS", 900, minimum=1, maximum=MAX_WINDOW_SECONDS)
SIGNUP_IP_LIMIT = _int("SIGNUP_IP_LIMIT", 5, minimum=1)
SIGNUP_IP_WINDOW_SECONDS = _int("SIGNUP_IP_WINDOW_SECONDS", 3600, minimum=1, maximum=MAX_WINDOW_SECONDS)


def _bool(name: str, default: bool) -> bool:
    raw = (os.getenv(name) or "").strip().lower()  # blank means unset
    if not raw:
        return default
    if raw in ("1", "true", "yes", "on"):
        return True
    if raw in ("0", "false", "no", "off"):
        return False
    raise ValueError(f"{name} must be true or false, got {raw!r}")


# True only behind a proxy you control: then the right-most X-Forwarded-For value is the client.
# Strict like COOKIE_SECURE: a typo fails startup instead of silently meaning false.
TRUST_PROXY = _bool("TRUST_PROXY", False)

MIN_PROXY_SECRET_LENGTH = 32


def _secret(name: str, minimum: int) -> str | None:
    """A secret from the environment: stripped, blank means unset, shorter than `minimum` is a
    startup error. The value is never put in the message."""
    value = (os.getenv(name) or "").strip()
    if not value:
        return None
    if len(value) < minimum:
        raise ValueError(f"{name} must be at least {minimum} characters (got {len(value)})")
    return value


# Shared secret between the Next proxy (frontend/src/proxy.ts) and this API. Only a request that
# carries it in X-Talaan-Proxy-Secret may name the client IP in X-Talaan-Client-IP
# (app/auth/rate_limit.py). Unset: that header is always ignored. Generate: openssl rand -hex 32
PROXY_SECRET = _secret("PROXY_SECRET", MIN_PROXY_SECRET_LENGTH)


# Session cookie Secure flag and `__Host-` name prefix (app/auth/cookies.py). Read at call
# time. Default true: a plain-http client (curl, Safari on localhost) will not send it back,
# so local work sets COOKIE_SECURE=false in .env.
COOKIE_SECURE = _bool("COOKIE_SECURE", True)


DEFAULT_PORTS = {"http": 80, "https": 443}


def _origin(entry: str) -> str:
    """One allow-list entry as the browser would send it in Origin: scheme://host[:port],
    lowercase, default port dropped. Anything else is a startup error naming the entry."""
    def bad(why: str) -> ValueError:
        return ValueError(f"ALLOWED_ORIGINS entry {entry!r} {why}; expected scheme://host[:port]")

    if "*" in entry:
        raise ValueError("ALLOWED_ORIGINS must list exact origins, not a wildcard")
    parts = urlsplit(entry.lower())
    if parts.scheme not in DEFAULT_PORTS:
        raise bad("must start with http:// or https://")
    if parts.username is not None or parts.password is not None:
        raise bad("must not contain user info")
    if parts.path not in ("", "/") or parts.query or parts.fragment or "?" in entry or "#" in entry:
        raise bad("must not have a path, query or fragment")
    try:
        port = parts.port
    except ValueError:
        raise bad("has an invalid port") from None
    host = parts.hostname
    if not host:
        raise bad("has no host")
    if ":" in host:  # IPv6 literal
        host = f"[{host}]"
    if port is not None and port != DEFAULT_PORTS[parts.scheme]:
        host = f"{host}:{port}"
    return f"{parts.scheme}://{host}"


def parse_origins(raw: str | None) -> frozenset[str]:
    """Comma-separated browser origins for the CSRF check (app/security.py). Entries are
    stripped and normalized by _origin; blanks are dropped; nothing left means the default.
    A wildcard or malformed entry is a startup error, never a fallback."""
    items = {_origin(part.strip()) for part in (raw or "").split(",") if part.strip()}
    return frozenset(items or {"http://localhost:3000"})


ALLOWED_ORIGINS = parse_origins(os.getenv("ALLOWED_ORIGINS"))


# Account deletion (POST /account/delete): wrong-password budget per user, attempts per IP.
ACCOUNT_DELETE_USER_LIMIT = _int("ACCOUNT_DELETE_USER_LIMIT", 5, minimum=1)
ACCOUNT_DELETE_USER_WINDOW_SECONDS = _int("ACCOUNT_DELETE_USER_WINDOW_SECONDS", 900, minimum=1, maximum=MAX_WINDOW_SECONDS)
ACCOUNT_DELETE_IP_LIMIT = _int("ACCOUNT_DELETE_IP_LIMIT", 10, minimum=1)
ACCOUNT_DELETE_IP_WINDOW_SECONDS = _int("ACCOUNT_DELETE_IP_WINDOW_SECONDS", 900, minimum=1, maximum=MAX_WINDOW_SECONDS)


# "development" (default, also blank) or "production". Production hides /docs, /redoc and
# /openapi.json and makes app/main.py refuse to start on a dev-grade config (production_problems).
# Anything else is a startup error, so a typo cannot silently mean "development".
ENVIRONMENT = (os.getenv("ENVIRONMENT") or "development").strip().lower()
if ENVIRONMENT not in ("development", "production"):
    raise ValueError(f"ENVIRONMENT must be development or production, got {ENVIRONMENT!r}")
PRODUCTION = ENVIRONMENT == "production"

MIN_PRODUCTION_BCRYPT_ROUNDS = DEFAULT_BCRYPT_ROUNDS
_LOCAL_HOSTS = ("localhost", "127.0.0.1", "[::1]")


def production_problems() -> list[str]:
    """Every reason this config is unfit for production, as messages naming the variable.
    Empty list means fine. Called by app/main.py only (not at import), so the admin CLI and
    alembic keep working with just DATABASE_URL."""
    problems = []
    if not COOKIE_SECURE:
        problems.append("COOKIE_SECURE must be true")
    if BCRYPT_ROUNDS < MIN_PRODUCTION_BCRYPT_ROUNDS:
        problems.append(f"BCRYPT_ROUNDS must be at least {MIN_PRODUCTION_BCRYPT_ROUNDS} (got {BCRYPT_ROUNDS})")
    if not PROXY_SECRET:
        problems.append("PROXY_SECRET must be set (without it every user shares one rate-limit bucket)")
    if not (os.getenv("ALLOWED_ORIGINS") or "").strip():
        problems.append("ALLOWED_ORIGINS must be set to the frontend's https origin")
    else:
        for origin in sorted(ALLOWED_ORIGINS):
            host = urlsplit(origin).hostname or ""
            host = f"[{host}]" if ":" in host else host
            if host in _LOCAL_HOSTS or host.endswith(".localhost"):
                problems.append(f"ALLOWED_ORIGINS must not list a local origin ({origin})")
            elif not origin.startswith("https://"):
                problems.append(f"ALLOWED_ORIGINS entries must be https ({origin})")
    return problems
