"""Password hashing and session-token helpers.

Stub — this is security logic, yours to write (CLAUDE.md rule 2).

You'll likely need something like:
    hash_password(raw: str) -> str
    verify_password(raw: str, hashed: str) -> bool
    generate_session_token() -> str   # cryptographically random, not a UUID4 guess

For hashing, look into `passlib[bcrypt]` (add to requirements.txt yourself
once you've decided on it) rather than rolling your own.
"""
import hashlib
import secrets

import bcrypt

from app import config


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=config.BCRYPT_ROUNDS))
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    raw = password.encode("utf-8")
    # bcrypt 5 raises above 72 bytes. Hash the first 72 anyway (same cost), then reject:
    # signup refuses such passwords, so none can be valid.
    matched = bcrypt.checkpw(raw[:72], hashed.encode("utf-8"))
    return matched and len(raw) <= 72


# Same algorithm and cost as real hashes, built once. Login verifies against it when the
# email is unknown, so unknown email and wrong password do the same work.
DUMMY_PASSWORD_HASH = hash_password(secrets.token_urlsafe(16))


def generate_session_token() -> str:
   
    return secrets.token_urlsafe(32)


def hash_session_token(token: str) -> str:
    """SHA-256 hex of the raw cookie token; only this digest is stored."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()
