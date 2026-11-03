"""Application configuration.

Reads settings from environment variables (loaded from a local .env file if
present). Keep real secrets in .env, never commit them — see .env.example.
"""

import os

from dotenv import load_dotenv

load_dotenv()

# Full SQLAlchemy connection string, e.g.
# postgresql+psycopg2://user:password@host:5432/dbname
DATABASE_URL = os.getenv(
    "DATABASE_URL",
    "postgresql+psycopg2://talaan@localhost:5432/talaan",
)


def _int(name: str, default: int) -> int:
    return int(os.getenv(name, default))


# bcrypt cost for new password hashes and the login dummy hash. Read at call time by
# hash_password; the dummy hash is built once at startup with the same value.
DEFAULT_BCRYPT_ROUNDS = 12
BCRYPT_ROUNDS = _int("BCRYPT_ROUNDS", DEFAULT_BCRYPT_ROUNDS)

# Rate limiting (app/auth/rate_limit.py). Read at call time, so tests can patch these.
LOGIN_IP_LIMIT = _int("LOGIN_IP_LIMIT", 10)
LOGIN_IP_WINDOW_SECONDS = _int("LOGIN_IP_WINDOW_SECONDS", 900)
LOGIN_EMAIL_LIMIT = _int("LOGIN_EMAIL_LIMIT", 5)
LOGIN_EMAIL_WINDOW_SECONDS = _int("LOGIN_EMAIL_WINDOW_SECONDS", 900)
SIGNUP_IP_LIMIT = _int("SIGNUP_IP_LIMIT", 5)
SIGNUP_IP_WINDOW_SECONDS = _int("SIGNUP_IP_WINDOW_SECONDS", 3600)

# True only behind a proxy you control: then the right-most X-Forwarded-For value is the client.
TRUST_PROXY = os.getenv("TRUST_PROXY", "false").strip().lower() in ("1", "true", "yes")
