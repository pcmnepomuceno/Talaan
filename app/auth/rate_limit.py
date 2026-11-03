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
    """Fixed-length key from the normalized email; the raw email is never stored."""
    return "login:email:" + hashlib.sha256(email.strip().lower().encode("utf-8")).hexdigest()


def check(db: Session, key: str, limit: int, window_seconds: int) -> int | None:
    """Prune this key's expired rows, then return seconds until a slot frees if over
    the limit, else None. Check-then-record is not atomic: concurrent requests can
    overshoot by a few (DECISIONS.md, 2026-11-03)."""
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
    # (0-based, oldest first) expires. Usually that is the oldest; after an overshoot it is later.
    freeing = events.order_by(RateLimitEvent.created_at).offset(count - limit).limit(1).scalar()
    return max(1, math.ceil((freeing + window - now).total_seconds()))


def record(db: Session, key: str) -> None:
    db.add(RateLimitEvent(key=key, created_at=utcnow()))


def clear(db: Session, key: str) -> None:
    db.query(RateLimitEvent).filter(RateLimitEvent.key == key).delete(synchronize_session=False)


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
