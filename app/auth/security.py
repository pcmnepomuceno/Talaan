"""Password hashing and session-token helpers.

Stub — this is security logic, yours to write (CLAUDE.md rule 2).

You'll likely need something like:
    hash_password(raw: str) -> str
    verify_password(raw: str, hashed: str) -> bool
    generate_session_token() -> str   # cryptographically random, not a UUID4 guess

For hashing, look into `passlib[bcrypt]` (add to requirements.txt yourself
once you've decided on it) rather than rolling your own.
"""
import secrets

import bcrypt


def hash_password(password: str) -> str:
    hashed = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt())
    return hashed.decode("utf-8")


def verify_password(password: str, hashed: str) -> bool:
    return bcrypt.checkpw(password.encode("utf-8"), hashed.encode("utf-8"))


def generate_session_token() -> str:
   
    return secrets.token_urlsafe(32)