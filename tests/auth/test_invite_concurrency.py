"""Real concurrency: threads with their own sessions and connections, committing to the
test DB for real. N signups race for one code: exactly one user is created."""

import threading
import uuid
from datetime import datetime, timedelta, timezone

from fastapi.testclient import TestClient

from app import config
from app.auth import invites
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
