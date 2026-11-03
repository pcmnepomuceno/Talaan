"""Real concurrency: threads with their own sessions and connections, committing to the
test DB for real. Races on one code and on one email: exactly one user is created."""

import threading
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import config
from app.auth import invites
from app.auth import router as auth_router
from app.auth.models import InviteCode, RateLimitEvent
from app.database import SessionLocal
from app.main import app
from app.users.models import User

N = 10
IP_KEY = "signup:ip:unknown"  # the TestClient peer has no parseable IP


def test_n_signups_race_for_one_code_exactly_one_wins(monkeypatch):
    monkeypatch.setattr(config, "SIGNUP_IP_LIMIT", 1000)  # all threads share one IP bucket
    run = uuid.uuid4().hex[:8]
    emails = [f"race-{run}-{i}@example.com" for i in range(N)]
    display, code_hash = invites.generate()
    setup = SessionLocal()
    setup.query(RateLimitEvent).filter_by(key=IP_KEY).delete()  # leftovers of an aborted run
    now = datetime.now(timezone.utc)
    setup.add(InviteCode(code_hash=code_hash, created_at=now, expires_at=now + timedelta(days=1)))
    setup.commit()

    barrier = threading.Barrier(N)
    statuses, errors = [], []

    def attempt(email):
        try:
            with TestClient(app) as c:
                barrier.wait(timeout=10)
                r = c.post(
                    "/api/v1/signup",
                    json={"email": email, "password": "Str0ng!pass", "account_name": "R", "invite_code": display},
                )
            statuses.append((r.status_code, r.json()))
        except Exception as e:  # noqa: BLE001 - a thread would swallow it; asserted below
            errors.append(e)

    try:
        threads = [threading.Thread(target=attempt, args=(e,)) for e in emails]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert not errors, errors
        codes = sorted(s for s, _ in statuses)
        assert codes == [200] + [400] * (N - 1), codes
        generic = {"detail": "Invalid or expired invite code."}
        assert all(body == generic for s, body in statuses if s == 400)

        check = SessionLocal()
        try:
            users = check.query(User).filter(User.email.in_(emails)).all()
            assert len(users) == 1  # the losers' user rows were rolled back
            row = check.query(InviteCode).filter_by(code_hash=code_hash).one()
            assert row.used_by_user_id == users[0].id and row.used_at is not None
        finally:
            check.close()
    finally:
        setup.rollback()
        setup.query(InviteCode).filter_by(code_hash=code_hash).delete()  # first: its FK points at the user
        setup.query(User).filter(User.email.in_(emails)).delete(synchronize_session=False)
        setup.query(RateLimitEvent).filter_by(key=IP_KEY).delete()
        setup.commit()
        setup.close()


def test_same_email_two_codes_race_one_user_one_code_used(monkeypatch):
    """Both requests pass the duplicate-email SELECT; the loser's INSERT hits the unique
    index. It must get the normal 400, not a 500, and its code must stay unused."""
    monkeypatch.setattr(config, "SIGNUP_IP_LIMIT", 1000)
    # hash_password runs after the duplicate-email SELECT: holding both requests there
    # forces the interleaving every run instead of by luck.
    past_check = threading.Barrier(2)
    real_hash = auth_router.hash_password

    def hash_after_both_checked(password):
        past_check.wait(timeout=10)
        return real_hash(password)

    monkeypatch.setattr(auth_router, "hash_password", hash_after_both_checked)
    email = f"race-email-{uuid.uuid4().hex[:8]}@example.com"
    codes = [invites.generate() for _ in range(2)]
    hashes = [h for _, h in codes]
    setup = SessionLocal()
    setup.query(RateLimitEvent).filter_by(key=IP_KEY).delete()
    now = datetime.now(timezone.utc)
    for h in hashes:
        setup.add(InviteCode(code_hash=h, created_at=now, expires_at=now + timedelta(days=1)))
    setup.commit()

    barrier = threading.Barrier(2)
    statuses, errors = [], []

    def attempt(display):
        try:
            with TestClient(app) as c:
                barrier.wait(timeout=10)
                r = c.post(
                    "/api/v1/signup",
                    json={"email": email, "password": "Str0ng!pass", "account_name": "R", "invite_code": display},
                )
            statuses.append((r.status_code, r.json()))
        except Exception as e:  # noqa: BLE001 - a thread would swallow it; asserted below
            errors.append(e)

    try:
        threads = [threading.Thread(target=attempt, args=(d,)) for d, _ in codes]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=60)
        assert not errors, errors
        assert sorted(s for s, _ in statuses) == [200, 400], statuses
        assert [b for s, b in statuses if s == 400] == [{"detail": "Email already exists."}]

        check = SessionLocal()
        try:
            users = check.query(User).filter_by(email=email).all()
            assert len(users) == 1
            rows = check.query(InviteCode).filter(InviteCode.code_hash.in_(hashes)).all()
            used = [r for r in rows if r.used_at is not None]
            assert len(rows) == 2 and len(used) == 1
            assert used[0].used_by_user_id == users[0].id
            unused = next(r for r in rows if r.used_at is None)
            assert unused.used_by_user_id is None
        finally:
            check.close()
    finally:
        setup.rollback()
        setup.query(InviteCode).filter(InviteCode.code_hash.in_(hashes)).delete(synchronize_session=False)
        setup.query(User).filter_by(email=email).delete(synchronize_session=False)
        setup.query(RateLimitEvent).filter_by(key=IP_KEY).delete()
        setup.commit()
        setup.close()
