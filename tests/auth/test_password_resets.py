"""Admin-generated password reset links (docs/AUTH.md).

No test may print a token: every token is wrapped in Secret (pytest tracebacks show argument
reprs), and checks on secret material are reduced to booleans before they are asserted.
"""

import hashlib
import json
import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import OperationalError

from app import config
from app.auth import password_resets, rate_limit
from app.auth.models import PasswordResetToken, RateLimitEvent
from app.auth.models import Session as SessionModel
from app.auth.security import hash_password, hash_session_token
from app.database import SessionLocal
from app.main import app
from app.users.models import User
from tests.concurrency import join_all, purge, spawn
from tests.conftest import USER_EMAIL, USER_PASSWORD, as_user

CREATE = "/api/v1/admin/password-resets"
RESET = "/api/v1/auth/reset-password"
FRIEND = "ana@example.ph"
OLD = "0ld!Passw0rd"
NEW = "N3w!Passw0rd"
INVALID = {"detail": "Invalid or expired reset link."}
NOW = datetime(2026, 11, 26, 12, 0, tzinfo=timezone.utc)


class Secret(str):
    def __repr__(self):
        return "<secret>"


@pytest.fixture
def admin(client, db, user, make_session, monkeypatch):
    """`user` is an admin with a session; the client is logged in as them."""
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    make_session("tok")
    as_user(client, "tok")
    return client


@pytest.fixture
def friend(db):
    u = User(email=FRIEND, password_hash=hash_password(OLD), account_name="Ana Cruz")
    db.add(u)
    db.commit()
    return u


def create(client, email=FRIEND, password=USER_PASSWORD):
    return client.post(CREATE, json={"email": email, "admin_password": password})


def link(client, **kw) -> Secret:
    r = create(client, **kw)
    assert r.status_code == 201
    return Secret(r.json()["token"])


def reset(client, token, new_password=NEW):
    return client.post(RESET, json={"token": token, "new_password": new_password})


def make_token(db, user_id, expires_in=timedelta(hours=1), used=False) -> Secret:
    token, token_hash = password_resets.generate()
    now = password_resets.utcnow()
    db.add(PasswordResetToken(user_id=user_id, token_hash=token_hash, created_at=now,
                              expires_at=now + expires_in, used_at=now if used else None))
    db.commit()
    return Secret(token)


def login(client, password):
    return client.post("/api/v1/login", json={"email": FRIEND, "password": password})


def add_sessions(db, user_id, n, prefix):
    now = datetime.now(timezone.utc)
    for i in range(n):
        db.add(SessionModel(token_hash=hash_session_token(f"{prefix}-{i}"), user_id=user_id,
                            created_at=now, expires_at=now + timedelta(days=1)))
    db.commit()


def session_count(db, user_id):
    return db.query(SessionModel).filter(SessionModel.user_id == user_id).count()


# --- create ---

def test_create_returns_token_and_expiry_and_stores_only_the_hash(admin, db, user, friend, monkeypatch):
    monkeypatch.setattr(password_resets, "utcnow", lambda: NOW)
    r = create(admin, email="  ANA@Example.PH ")
    assert r.status_code == 201
    assert r.headers["cache-control"] == "no-store"
    keys = set(r.json())
    assert keys == {"token", "expires_at"}
    expires_at = r.json()["expires_at"]  # outside the assert, which would show the whole body
    assert datetime.fromisoformat(expires_at) == NOW + timedelta(hours=24)
    token = Secret(r.json()["token"])
    row = db.query(PasswordResetToken).one()
    hashed = row.token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert hashed
    assert (row.user_id, row.created_by, row.used_at) == (friend.id, user.id, None)
    assert row.created_at == NOW and row.expires_at - row.created_at == timedelta(hours=24)
    stored = db.execute(text("SELECT * FROM password_reset_tokens")).one()
    leaked = any(token in str(value) for value in stored)
    assert not leaked


def test_creating_a_link_signs_nobody_out(admin, db, friend):
    add_sessions(db, friend.id, 2, "ana")
    link(admin)
    assert session_count(db, friend.id) == 2


def test_anonymous_gets_401(client, user, friend, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    r = create(client)
    assert r.status_code == 401 and r.headers["cache-control"] == "no-store"


def test_non_admin_gets_404_and_nothing_happens(client, db, user, make_session, friend, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"someone-else@example.ph"}))
    make_session("tok")
    as_user(client, "tok")
    for r in (create(client), client.post(CREATE, json={})):
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
        assert r.headers["cache-control"] == "no-store"
    assert db.query(PasswordResetToken).count() == 0
    assert db.query(RateLimitEvent).count() == 0


def test_wrong_admin_password_is_403_even_for_an_unknown_email(admin, db, friend):
    for email in (FRIEND, "nobody@example.ph"):
        r = create(admin, email=email, password="Wr0ng!pass")
        assert r.status_code == 403 and r.json() == {"detail": "Incorrect password."}
        assert r.headers["cache-control"] == "no-store"
    assert db.query(PasswordResetToken).count() == 0


def test_unknown_email_is_404(admin, db):
    r = create(admin, email="nobody@example.ph")
    assert r.status_code == 404 and r.json() == {"detail": "No account with that email."}
    assert db.query(PasswordResetToken).count() == 0


def test_own_account_is_refused(admin, db):
    r = create(admin, email=USER_EMAIL)
    assert r.status_code == 400 and r.json() == {"detail": "You can't reset your own password here."}
    assert db.query(PasswordResetToken).count() == 0


def test_another_admin_is_refused(admin, db, friend, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL, FRIEND}))
    r = create(admin)
    assert r.status_code == 400 and r.json() == {"detail": "Admin accounts are reset with the CLI."}
    assert db.query(PasswordResetToken).count() == 0


def test_create_extra_field_is_422(admin, db, friend):
    r = admin.post(CREATE, json={"email": FRIEND, "admin_password": USER_PASSWORD, "user_id": 1})
    assert r.status_code == 422 and db.query(PasswordResetToken).count() == 0


@pytest.mark.parametrize("name", ["ADMIN_RESET_USER_LIMIT", "ADMIN_RESET_IP_LIMIT"])
def test_create_limit_counts_failed_attempts_and_blocks_before_bcrypt(admin, db, friend, monkeypatch, name):
    monkeypatch.setattr(config, name, 2)
    assert create(admin, password="Wr0ng!pass").status_code == 403
    assert create(admin, password="Wr0ng!pass").status_code == 403
    calls = []
    monkeypatch.setattr(password_resets, "verify_password", lambda *a: calls.append(1))
    r = create(admin)
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert not calls and db.query(PasswordResetToken).count() == 0


def test_a_new_link_voids_the_previous_unused_one_only(admin, db, user, friend):
    used_hash = hash_session_token(make_token(db, friend.id, used=True))
    make_token(db, user.id)  # another account's link is not touched
    first = link(admin)
    second = link(admin)
    assert reset(admin, first).json() == INVALID
    assert db.query(PasswordResetToken).filter_by(user_id=friend.id, used_at=None).count() == 1
    assert db.query(PasswordResetToken).filter_by(user_id=user.id).count() == 1
    assert db.query(PasswordResetToken).filter_by(token_hash=used_hash).count() == 1
    assert reset(admin, second).status_code == 204


# --- reset ---

def test_reset_changes_the_password_and_ends_only_that_users_sessions(client, db, user, make_session, friend):
    make_session("mine")
    add_sessions(db, friend.id, 3, "ana")
    token = make_token(db, friend.id)
    r = reset(client, token)
    assert r.status_code == 204 and r.content == b""
    assert r.headers["cache-control"] == "no-store" and "set-cookie" not in r.headers
    assert session_count(db, friend.id) == 0 and session_count(db, user.id) == 1
    db.expire_all()
    assert db.query(PasswordResetToken).one().used_at is not None
    assert login(client, OLD).status_code == 401
    assert login(client, NEW).status_code == 200


def test_reset_clears_the_login_lockout(client, db, friend, monkeypatch):
    monkeypatch.setattr(config, "LOGIN_EMAIL_LIMIT", 2)
    monkeypatch.setattr(config, "LOGIN_IP_LIMIT", 100)
    for _ in range(2):
        assert login(client, "Wr0ng!pass").status_code == 401
    assert login(client, OLD).status_code == 429
    assert reset(client, make_token(db, friend.id)).status_code == 204
    assert db.query(RateLimitEvent).filter_by(key=rate_limit.email_key(FRIEND)).count() == 0
    assert login(client, NEW).status_code == 200


def test_the_same_password_as_before_is_allowed(client, db, friend):
    assert reset(client, make_token(db, friend.id), new_password=OLD).status_code == 204
    assert login(client, OLD).status_code == 200


def test_a_token_works_once(client, db, friend):
    token = make_token(db, friend.id)
    assert reset(client, token).status_code == 204
    again = reset(client, token, new_password="An0ther!pass")
    assert again.status_code == 400 and again.json() == INVALID
    assert login(client, NEW).status_code == 200


@pytest.mark.parametrize("age, expected", [
    (timedelta(hours=24, seconds=-1), 204),
    (timedelta(hours=24), 400),
    (timedelta(hours=24, seconds=1), 400),
])
def test_expiry_boundary(admin, friend, monkeypatch, age, expected):
    monkeypatch.setattr(password_resets, "utcnow", lambda: NOW)
    token = link(admin)
    monkeypatch.setattr(password_resets, "utcnow", lambda: NOW + age)
    assert reset(admin, token).status_code == expected


def test_user_deleted_after_the_link_was_made(client, db, friend):
    token = make_token(db, friend.id)
    db.query(User).filter(User.id == friend.id).delete(synchronize_session=False)
    db.commit()
    r = reset(client, token)
    assert r.status_code == 400 and r.json() == INVALID


def test_every_bad_token_gets_the_identical_response(admin, db, friend, monkeypatch):
    monkeypatch.setattr(config, "RESET_PASSWORD_IP_LIMIT", 100)
    expired = make_token(db, friend.id, expires_in=timedelta(seconds=-1))
    used = make_token(db, friend.id, used=True)
    voided = link(admin)
    link(admin)
    bad = {
        "expired": expired,
        "used": used,
        "voided": voided,
        "unknown": Secret(password_resets.generate()[0]),
        "empty": "",
        "non-ascii": "töken",
        "lone surrogate": "\ud800",
        "65 characters": "a" * 65,
        "huge": "a" * 10_000,
        "nul": "a\x00b",
    }
    before = db.query(User.password_hash).filter(User.id == friend.id).scalar()
    for name, token in bad.items():
        body = f'{{"token": {json_string(token)}, "new_password": "{NEW}"}}'
        r = admin.post(RESET, content=body, headers={"content-type": "application/json"})
        assert (r.status_code, r.json()) == (400, INVALID), name
        assert r.headers["cache-control"] == "no-store", name
    db.expire_all()
    assert db.query(User.password_hash).filter(User.id == friend.id).scalar() == before


def json_string(value: str) -> Secret:
    """JSON with every non-ASCII character escaped (a lone surrogate cannot be sent raw)."""
    return Secret(json.dumps(str(value)))


@pytest.mark.parametrize("password", ["Sh0rt!x_but" * 8, "weak", "N3w!Pass\x00word", "N3w!Pass\ud800word"])
def test_422_never_echoes_the_token_or_the_password(client, db, friend, password):
    token = make_token(db, friend.id)
    body = f'{{"token": {json_string(token)}, "new_password": {json_string(password)}}}'
    r = client.post(RESET, content=body, headers={"content-type": "application/json"})
    assert r.status_code == 422
    token_echoed = token in r.text  # first: later asserts show parts of the body
    password_echoed = password in r.text
    assert not token_echoed and not password_echoed
    assert r.json()["detail"][0]["loc"][-1] == "new_password"
    assert db.query(PasswordResetToken).one().used_at is None


def test_422_for_a_missing_field_never_echoes_the_token(client, db, friend):
    token = make_token(db, friend.id)
    r = client.post(RESET, json={"token": token})
    assert r.status_code == 422
    echoed = token in r.text
    assert not echoed


def test_nothing_logs_the_token_or_the_password(admin, db, friend, caplog):
    caplog.set_level(logging.DEBUG)
    token = link(admin)
    assert reset(admin, token).status_code == 204
    assert reset(admin, token).status_code == 400
    assert reset(admin, token, new_password="weak").status_code == 422
    token_logged = token in caplog.text
    password_logged = NEW in caplog.text or USER_PASSWORD in caplog.text
    assert not token_logged and not password_logged


def test_reset_limit_counts_failures_and_successes_and_blocks_before_bcrypt(client, db, friend, monkeypatch):
    monkeypatch.setattr(config, "RESET_PASSWORD_IP_LIMIT", 3)
    assert reset(client, "nope").status_code == 400
    assert reset(client, Secret(password_resets.generate()[0])).status_code == 400
    assert reset(client, make_token(db, friend.id)).status_code == 204
    calls = []
    monkeypatch.setattr(password_resets, "hash_password", lambda p: calls.append(1))
    token = make_token(db, friend.id)
    r = reset(client, token)
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert not calls
    assert db.query(PasswordResetToken).filter_by(used_at=None).count() == 1


def test_cross_site_reset_is_blocked(client, db, friend):
    token = make_token(db, friend.id)
    r = client.post(RESET, json={"token": token, "new_password": NEW}, headers={"origin": "https://evil.example"})
    assert r.status_code == 403
    assert db.query(PasswordResetToken).one().used_at is None


# --- real concurrency: committed rows, own connections, cleaned up in `finally` ---

@pytest.fixture
def committed_user():
    setup = SessionLocal()
    u = User(email=f"reset-{uuid.uuid4().hex[:8]}@example.com", password_hash="x", account_name="R")
    setup.add(u)
    setup.commit()
    user_id, email = u.id, u.email
    setup.close()
    yield user_id
    purge(
        ("DELETE FROM users WHERE id = :id", {"id": user_id}),
        ("DELETE FROM rate_limit_events WHERE key IN ('reset-password:ip:unknown', :k)",
         {"k": rate_limit.email_key(email)}),
    )


def committed_token(user_id) -> Secret:
    db = SessionLocal()
    try:
        return make_token(db, user_id)
    finally:
        db.close()


def test_two_requests_race_for_one_token_exactly_one_wins(committed_user, monkeypatch):
    token = committed_token(committed_user)
    both_hashing = threading.Barrier(2)  # both are past the limiter before either consumes
    real_hash = password_resets.hash_password

    def hash_together(password):
        both_hashing.wait(timeout=10)
        return real_hash(password)

    monkeypatch.setattr(password_resets, "hash_password", hash_together)
    statuses, errors = [], []

    def attempt():
        try:
            with TestClient(app) as c:
                statuses.append(reset(c, token).status_code)
        except Exception as e:  # noqa: BLE001 - a thread would swallow it; asserted below
            errors.append(type(e).__name__)

    join_all([spawn(attempt) for _ in range(2)], timeout=60)
    assert not errors, errors
    assert sorted(statuses) == [204, 400]


def test_two_concurrent_creates_leave_one_unused_link(committed_user):
    holder, other = SessionLocal(), SessionLocal()
    errors = []

    def second():
        try:
            password_resets.create(other, committed_user, None)
            other.commit()
        except Exception as e:  # noqa: BLE001
            errors.append(type(e).__name__)

    try:
        password_resets.create(holder, committed_user, None)  # open: holds the user row lock
        t = spawn(second)
        t.join(0.5)
        assert t.is_alive()  # waiting for the first create to commit
        holder.commit()
        join_all([t], timeout=10)
        assert not errors, errors
        assert holder.query(PasswordResetToken).filter_by(user_id=committed_user, used_at=None).count() == 1
    finally:
        holder.rollback()
        holder.close()
        other.rollback()
        other.close()


def test_reset_takes_the_user_lock_before_the_token_so_a_create_cannot_deadlock(committed_user):
    """create (and account delete) lock the user row, then delete its tokens. A reset must take
    the same order, or each ends up holding what the other wants."""
    token = committed_token(committed_user)
    holder = SessionLocal()
    statuses, errors = [], []

    def attempt():
        try:
            with TestClient(app) as c:
                statuses.append(reset(c, token).status_code)
        except Exception as e:  # noqa: BLE001
            errors.append(type(e).__name__)

    try:
        holder.execute(text("SELECT id FROM users WHERE id = :id FOR UPDATE"), {"id": committed_user})
        t = spawn(attempt)
        t.join(1.0)
        assert t.is_alive()  # the reset is waiting for the user row
        password_resets.create(holder, committed_user, None)  # deletes the token being reset
        holder.commit()
        join_all([t], timeout=15)
        assert not errors, errors
        assert statuses == [400]
    finally:
        holder.rollback()
        holder.close()


# --- reset vs login ---

@pytest.fixture
def committed_friend(monkeypatch):
    """A committed account with a real password hash, for races between reset and login."""
    for name in ("LOGIN_IP_LIMIT", "LOGIN_EMAIL_LIMIT", "RESET_PASSWORD_IP_LIMIT"):
        monkeypatch.setattr(config, name, 10_000)
    setup = SessionLocal()
    u = User(email=f"race-{uuid.uuid4().hex[:8]}@example.com", password_hash=hash_password(OLD),
             account_name="Race")
    setup.add(u)
    setup.commit()
    user_id, email = u.id, u.email
    setup.close()
    yield user_id, email
    purge(
        ("DELETE FROM users WHERE id = :id", {"id": user_id}),
        ("DELETE FROM rate_limit_events WHERE key IN ('reset-password:ip:unknown', 'login:ip:unknown', :k)",
         {"k": rate_limit.email_key(email)}),
    )


def committed_sessions_and_lockout(user_id, email) -> tuple[int, int]:
    db = SessionLocal()
    try:
        return (db.query(SessionModel).filter(SessionModel.user_id == user_id).count(),
                db.query(RateLimitEvent).filter_by(key=rate_limit.email_key(email)).count())
    finally:
        db.close()


def run_request(results, errors, name, send):
    """Run one request in its own client; record the status, or the first line of what it raised."""
    try:
        with TestClient(app) as c:
            results[name] = send(c).status_code
    except Exception as e:  # noqa: BLE001 - a thread would swallow it; asserted by the caller
        errors.append(f"{name}: {type(e).__name__}: {str(e).splitlines()[0]}")


def test_reset_racing_a_successful_login_does_not_deadlock(committed_friend, monkeypatch):
    """The reset holds the user row; login then deletes its limiter row and goes on to need the user
    row. The reset must not wait for that limiter row, or each waits for the other. Forced, not
    left to timing."""
    user_id, email = committed_friend
    token = committed_token(user_id)
    reset_has_user_row, limiter_row_deleted = threading.Event(), threading.Event()
    real_delete, real_consume = rate_limit.delete_event, password_resets.consume

    errors = []

    def delete_event(*a, **kw):
        if not reset_has_user_row.wait(10):
            errors.append("sync: the reset never took the user row")
        real_delete(*a, **kw)
        limiter_row_deleted.set()

    def consume(db, token_hash):  # called with the user row already locked
        reset_has_user_row.set()
        if not limiter_row_deleted.wait(10):
            errors.append("sync: login never deleted its limiter row")
        return real_consume(db, token_hash)

    monkeypatch.setattr(rate_limit, "delete_event", delete_event)
    monkeypatch.setattr(password_resets, "consume", consume)
    results = {}
    join_all([
        spawn(run_request, results, errors, "login", lambda c: c.post(
            "/api/v1/login", json={"email": email, "password": OLD})),
        spawn(run_request, results, errors, "reset", lambda c: reset(c, token)),
    ], timeout=60)
    assert not errors, errors
    assert results == {"reset": 204, "login": 401}
    assert committed_sessions_and_lockout(user_id, email) == (0, 0)
    with TestClient(app) as c:
        assert c.post("/api/v1/login", json={"email": email, "password": NEW}).status_code == 200


def race_once(user_id, email, old, new):
    """Login with the old password and reset to the new one, started together."""
    token = committed_token(user_id)
    start = threading.Barrier(2)
    results, errors = {}, []

    def login_request(c):
        start.wait(timeout=10)
        return c.post("/api/v1/login", json={"email": email, "password": old})

    def reset_request(c):
        start.wait(timeout=10)
        return reset(c, token, new_password=new)

    join_all([
        spawn(run_request, results, errors, "login", login_request),
        spawn(run_request, results, errors, "reset", reset_request),
    ], timeout=60)
    return results, errors


def test_reset_and_login_race_repeatedly(committed_friend):
    user_id, email = committed_friend
    current = OLD
    for i in range(25):
        new = NEW if current == OLD else OLD
        results, errors = race_once(user_id, email, current, new)
        assert not errors, (i, errors)
        assert results["reset"] == 204 and results["login"] in (200, 401), (i, results)
        assert committed_sessions_and_lockout(user_id, email)[0] == 0, (i, results)
        current = new


def test_a_failed_lockout_clear_after_the_commit_is_still_a_204(client, db, friend, monkeypatch, caplog):
    def broken(_email):
        raise OperationalError("DELETE", {}, Exception("connection lost"))

    add_sessions(db, friend.id, 2, "ana")
    monkeypatch.setattr(rate_limit, "email_key", broken)
    monkeypatch.setattr(password_resets.logger, "disabled", False)  # alembic's fileConfig disabled it
    with caplog.at_level(logging.WARNING, logger="app.auth.password_resets"):
        r = reset(client, make_token(db, friend.id))
    assert r.status_code == 204
    assert session_count(db, friend.id) == 0
    warned = "lockout" in caplog.text and FRIEND not in caplog.text
    monkeypatch.undo()
    db.expire_all()
    assert login(client, NEW).status_code == 200
    assert warned


def test_a_dead_connection_during_the_lockout_clear_is_still_a_204(client, db, friend, monkeypatch):
    """The rollback after a failed clear fails too (the connection is gone): still a 204."""
    def broken(_email):
        raise OperationalError("DELETE", {}, Exception("connection lost"))

    def dead_rollback():
        raise OperationalError("ROLLBACK", {}, Exception("connection lost"))

    token = make_token(db, friend.id)
    monkeypatch.setattr(rate_limit, "email_key", broken)
    monkeypatch.setattr(db, "rollback", dead_rollback)
    assert reset(client, token).status_code == 204
    monkeypatch.undo()
    db.expire_all()
    assert login(client, NEW).status_code == 200
