"""Invite codes: generation, normalization, lookup and atomic consumption.

A code is 12 Crockford base32 characters, shown as TLN-XXXX-XXXX-XXXX. Only the SHA-256
of the normalized 12 characters is stored. Never log or return a plaintext code (the admin
CLI prints it once at creation).
"""

import hashlib
import secrets
from datetime import datetime, timezone

from fastapi import HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth.models import InviteCode

# Crockford base32: no I, L, O, U. 12 characters = 60 bits.
ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
# Crockford decoding: letters easily misread for digits map to them.
ALIASES = str.maketrans("OIL", "011")
CODE_LENGTH = 12
PREFIX = "TLN"
# The prefix after alias mapping (L -> 1). Only stripped from prefix + body input.
MAPPED_PREFIX = PREFIX.translate(ALIASES)
# Longer input is rejected before any work. Same answer as every other bad code.
MAX_INPUT_LEN = 64


def utcnow() -> datetime:
    """This module's clock. Tests patch it instead of sleeping."""
    return datetime.now(timezone.utc)


def normalize(raw: str) -> str | None:
    """ASCII only, uppercase, drop whitespace and dashes, map O to 0 and I/L to 1, then drop
    a leading TLN only when exactly prefix + body long (a body can start with T1N, which is
    also what TLN maps to). Return the 12-character body, or None if malformed.
    Non-ASCII is rejected before uppercasing: some characters uppercase into the alphabet
    (U+017F long s becomes S), which would accept a non-canonical code."""
    if not isinstance(raw, str) or len(raw) > MAX_INPUT_LEN or not raw.isascii():
        return None
    body = "".join(ch for ch in raw.upper() if not ch.isspace() and ch != "-")
    body = body.translate(ALIASES)
    if len(body) == len(PREFIX) + CODE_LENGTH and body.startswith(MAPPED_PREFIX):
        body = body[len(PREFIX):]
    if len(body) != CODE_LENGTH or any(ch not in ALPHABET for ch in body):
        return None
    return body


def hash_code(body: str) -> str:
    """SHA-256 hex of a normalized 12-character body."""
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


def generate() -> tuple[str, str]:
    """Return (display code, hash). The display code exists only in the caller's memory."""
    body = "".join(secrets.choice(ALPHABET) for _ in range(CODE_LENGTH))
    display = f"{PREFIX}-{body[:4]}-{body[4:8]}-{body[8:]}"
    return display, hash_code(body)


def invalid() -> HTTPException:
    """The one response for every bad-code case: unknown, expired, used, malformed."""
    return HTTPException(status_code=400, detail="Invalid or expired invite code.")


def is_valid(db: Session, code_hash: str) -> bool:
    """Non-consuming check: exists, unused, and strictly before expires_at."""
    now = utcnow()
    return (
        db.query(InviteCode.id)
        .filter(
            InviteCode.code_hash == code_hash,
            InviteCode.used_at.is_(None),
            InviteCode.expires_at > now,
        )
        .first()
        is not None
    )


def consume(db: Session, code_hash: str, user_id: int) -> bool:
    """Atomically mark the code used by user_id. False if it was used, expired or missing
    in the meantime. Under a race, one UPDATE wins; the other waits on the row lock, then
    sees used_at set and matches nothing. Flushes nothing else; the caller commits."""
    row = db.execute(
        text(
            "UPDATE invite_codes SET used_at = :now, used_by_user_id = :uid "
            "WHERE code_hash = :h AND used_at IS NULL AND expires_at > :now RETURNING id"
        ),
        {"now": utcnow(), "uid": user_id, "h": code_hash},
    ).first()
    return row is not None
