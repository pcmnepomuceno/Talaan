"""Sliding-window rate limiter backed by the `rate_limit_events` table.

One row per attempt. A key is over its limit when it has `limit` rows newer
than `window`. Keys never hold a raw email: see `email_key`.
"""

import hashlib
import ipaddress
import logging
import math
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

from fastapi import HTTPException, Request
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import config
from app.auth.models import RateLimitEvent

logger = logging.getLogger(__name__)

def utcnow() -> datetime:
    """The limiter's clock. Tests patch this instead of sleeping."""
    return datetime.now(timezone.utc)


def _normalize_ip(value: str | None) -> str:
    try:
        ip = ipaddress.ip_address((value or "").strip())
    except ValueError:
        return "unknown"
    if ip.version == 6:
        if ip.ipv4_mapped:
            return str(ip.ipv4_mapped)
        # One host normally owns a whole /64, so per-address keys would be free to rotate.
        return str(ipaddress.ip_network(f"{ip}/64", strict=False))
    return str(ip)


def _strip_port(value: str) -> str:
    """`1.2.3.4:5678` and `[2001:db8::1]:5678` lose the port; bare IPv6 is left alone."""
    value = value.strip()
    if value.startswith("[") and "]" in value:
        return value[1 : value.index("]")]
    if value.count(":") == 1:
        return value.split(":")[0]
    return value


def client_ip(request: Request) -> str:
    """Socket peer by default. With TRUST_PROXY, the right-most X-Forwarded-For value
    (the one our own proxy appended; anything left of it is client-controlled).
    Missing or unparsable addresses share the bucket "unknown", so they are still limited."""
    if config.TRUST_PROXY:
        hop = ",".join(request.headers.getlist("x-forwarded-for")).split(",")[-1]
        ip = _normalize_ip(_strip_port(hop))
        if ip == "unknown":
            # Every such request shares one bucket, so a misconfigured proxy locks out
            # everyone: make it visible. Short repr only (no full header, no newlines).
            logger.warning("TRUST_PROXY: no usable X-Forwarded-For address (right-most hop %r)", hop.strip()[:40])
        return ip
    return _normalize_ip(request.client.host if request.client else None)


def email_key(email: str) -> str:
    """Fixed-length key from an email already normalized by UserLogin; the raw email is
    never stored."""
    return "login:email:" + hashlib.sha256(email.encode("utf-8")).hexdigest()


def check(db: Session, key: str, limit: int, window_seconds: int) -> int | None:
    """Prune this key's expired rows, then return seconds until a slot frees if over
    the limit, else None. Not atomic on its own: call it through enforce(), which holds
    the key's advisory lock (DECISIONS.md, 2026-11-03)."""
    now = utcnow()
    window = timedelta(seconds=window_seconds)
    db.query(RateLimitEvent).filter(
        RateLimitEvent.key == key, RateLimitEvent.created_at <= now - window
    ).delete(synchronize_session=False)
    events = db.query(RateLimitEvent.created_at).filter(RateLimitEvent.key == key)
    count = events.count()
    if count < limit:
        return None
    # A slot frees when count drops to limit - 1, i.e. when the (count - limit)-th event
    # (0-based, oldest first) expires. Usually that is the oldest; it is later if the key is
    # over the limit (rows from before the lock, or a lowered limit).
    freeing = events.order_by(RateLimitEvent.created_at).offset(count - limit).limit(1).scalar()
    return max(1, math.ceil((freeing + window - now).total_seconds()))


def record(db: Session, key: str) -> int:
    """Add one attempt and return its row id (flushed, not committed)."""
    event = RateLimitEvent(key=key, created_at=utcnow())
    db.add(event)
    db.flush()
    return event.id


def delete_event(db: Session, event_id: int) -> None:
    """Remove one recorded attempt by id. Needs no lock: removing a row only frees budget."""
    db.query(RateLimitEvent).filter(RateLimitEvent.id == event_id).delete(synchronize_session=False)


def lock_id(key: str) -> int:
    """Advisory lock id for a key: the first 8 bytes of SHA-256(key) as a signed bigint."""
    return int.from_bytes(hashlib.sha256(key.encode("utf-8")).digest()[:8], "big", signed=True)


def lock_ids(keys) -> list[int]:
    """Deduplicated lock ids in ascending order. Ordering by the id itself (not by key)
    means every caller takes any shared locks in the same order, even when two different
    keys collide on one id, so lock waits cannot form a cycle."""
    return sorted({lock_id(key) for key in keys})


def enforce(db: Session, *limits: tuple[str, int, int]) -> dict[str, int]:
    """Check every (key, limit, window_seconds). If none is over, record one attempt per key
    and return {key: event id}, so a caller can later delete its own attempt.
    Commits either way (keeps the prune, and the attempt counts even if the client then
    disconnects), so call it before any slow work such as bcrypt. Over a limit: 429 with
    the longest wait. Blocked attempts are not recorded, so a lockout ends with its window.
    A DB error: 503.

    Atomic per key: a transaction-scoped advisory lock per key serializes concurrent
    callers from prune to commit, so a burst lets exactly `limit` through. See lock_ids for
    why callers cannot deadlock. The commit releases the locks: never hold them across
    slow work."""
    with fail_closed(db):
        for lock in lock_ids(key for key, _, _ in limits):
            db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": lock})
        waits = [w for key, limit, window in limits if (w := check(db, key, limit, window)) is not None]
        ids = {} if waits else {key: record(db, key) for key, _, _ in limits}
        db.commit()
    if waits:
        raise too_many(max(waits))
    return ids


def too_many(retry_after: int) -> HTTPException:
    """Same body for every limit, so a client cannot tell which one it hit."""
    return HTTPException(
        status_code=429,
        detail="Too many attempts. Try again later.",
        headers={"Retry-After": str(retry_after)},
    )


@contextmanager
def fail_closed(db: Session):
    """A limiter DB error becomes 503, never a silent pass. 503 and not 429 because
    the fault is ours: a 429 would invent a Retry-After and mislead clients."""
    try:
        yield
    except SQLAlchemyError:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass  # dead connection: rollback fails too, but the answer is still 503
        raise HTTPException(status_code=503, detail="Service temporarily unavailable.") from None
