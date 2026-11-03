"""Real concurrency: threads with their own sessions and connections, committing to the
test DB for real (not the per-test rolled-back session). Keys are unique per run and
deleted in `finally`."""

import threading
import uuid

from fastapi import HTTPException

from app.auth import rate_limit
from app.auth.models import RateLimitEvent
from app.database import SessionLocal

N = 20
LIMIT = 5


def burst(make_limits):
    """Run N enforce() calls released together by a barrier; return (passed, blocked)."""
    barrier = threading.Barrier(N)
    results, errors = [], []

    def attempt(i):
        db = SessionLocal()
        try:
            barrier.wait(timeout=10)
            rate_limit.enforce(db, *make_limits(i))
            results.append("pass")
        except HTTPException as e:
            results.append(e.status_code)
        except Exception as e:  # noqa: BLE001 - a thread would swallow it; asserted below
            errors.append(e)
        finally:
            db.close()

    threads = [threading.Thread(target=attempt, args=(i,)) for i in range(N)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(timeout=30)
    assert not errors, errors
    return results.count("pass"), results.count(429)


def cleanup(*keys):
    db = SessionLocal()
    try:
        db.query(RateLimitEvent).filter(RateLimitEvent.key.in_(keys)).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def count(key):
    db = SessionLocal()
    try:
        return db.query(RateLimitEvent).filter_by(key=key).count()
    finally:
        db.close()


def test_parallel_burst_lets_exactly_limit_through():
    key = f"test:concurrency:{uuid.uuid4()}"
    try:
        assert burst(lambda i: [(key, LIMIT, 60)]) == (LIMIT, N - LIMIT)
        assert count(key) == LIMIT
    finally:
        cleanup(key)


def test_parallel_burst_on_two_keys_in_either_order_is_exact_and_does_not_deadlock():
    """Login passes (ip, email). Half the threads pass them reversed: the lock order must
    not depend on argument order. The tighter limit (email) decides."""
    ip, email = f"test:ip:{uuid.uuid4()}", f"test:email:{uuid.uuid4()}"
    pair = [(ip, 10, 60), (email, LIMIT, 60)]
    try:
        assert burst(lambda i: pair if i % 2 else pair[::-1]) == (LIMIT, N - LIMIT)
        assert count(ip) == count(email) == LIMIT
    finally:
        cleanup(ip, email)


def test_login_releases_the_locks_before_bcrypt(monkeypatch):
    """Through the real route and real sessions: while the password is being verified,
    another connection can take both keys' advisory locks, and both rows are committed."""
    from fastapi.testclient import TestClient
    from sqlalchemy import text

    from app.auth import router
    from app.main import app

    email = f"lock-{uuid.uuid4()}@example.com"
    ip_key, em_key = "login:ip:unknown", rate_limit.email_key(email)  # TestClient peer is "testclient"
    seen = {}

    def spy(password, hashed):
        other = SessionLocal()
        try:
            for key in (ip_key, em_key):
                seen[key] = other.execute(text("SELECT pg_try_advisory_xact_lock(hashtext(:k))"), {"k": key}).scalar()
            seen["rows"] = (count(ip_key), count(em_key))
        finally:
            other.close()
        return False

    monkeypatch.setattr(router, "verify_password", spy)
    cleanup(ip_key)  # the shared IP key may hold committed rows from an aborted earlier run
    try:
        with TestClient(app) as c:
            r = c.post("/api/v1/login", json={"email": email, "password": "Wr0ng!pass"})
        assert r.status_code == 401
        assert seen == {ip_key: True, em_key: True, "rows": (1, 1)}
    finally:
        cleanup(ip_key, em_key)
