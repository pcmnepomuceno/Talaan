import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import event, insert, text
from sqlalchemy.exc import OperationalError

from app import config
from app.applications.models import JobApplication
from app.auth import rate_limit
from app.auth.models import InviteCode, RateLimitEvent
from app.auth.models import Session as SessionModel
from app.auth.security import hash_password, hash_session_token
from app.database import SessionLocal
from app.interviews.models import Interview
from app.users.models import User
from tests.concurrency import join_all, purge, spawn
from tests.conftest import USER_EMAIL, USER_PASSWORD, as_user, create_invite

URL = "/api/v1/account/delete"
BAD = "Wr0ng!pass"


def delete(client, password=USER_PASSWORD, **kw):
    return client.post(URL, json={"password": password}, **kw)


def add_data(db, user, n_apps=2, n_interviews=2):
    """n_apps applications for `user`, each with n_interviews interviews (bulk, no N+1)."""
    rows = [
        {"company": "Co", "job_name": f"J{i}", "status": "applied", "mode_of_work": "remote", "created_by": user.id}
        for i in range(n_apps)
    ]
    ids = db.execute(insert(JobApplication).returning(JobApplication.id), rows).scalars().all()
    when = datetime.now(timezone.utc)
    db.execute(
        insert(Interview),
        [
            {"job_application_id": a, "scheduled_at": when, "mode": "online", "outcome": "pending"}
            for a in ids
            for _ in range(n_interviews)
        ],
    )
    db.commit()


def counts(db, user_id):
    return {
        "users": db.query(User).filter(User.id == user_id).count(),
        "sessions": db.query(SessionModel).filter_by(user_id=user_id).count(),
        "applications": db.query(JobApplication).filter_by(created_by=user_id).count(),
        "interviews": db.query(Interview)
        .join(JobApplication, Interview.job_application_id == JobApplication.id)
        .filter(JobApplication.created_by == user_id)
        .count(),
    }


def other_user(db):
    u = User(email="other@example.com", password_hash="x", account_name="Other")
    db.add(u)
    db.commit()
    now = datetime.now(timezone.utc)
    db.add(SessionModel(token_hash=hash_session_token("tok-other"), user_id=u.id, created_at=now, expires_at=now + timedelta(days=1)))
    db.commit()
    add_data(db, u, 3, 2)
    return u


@pytest.fixture
def authed(client, make_session):
    make_session("tok")
    as_user(client, "tok")
    return client


def test_success_deletes_everything_for_that_user_only(authed, db, user, make_session):
    make_session("tok-second")  # a second session of the same user
    add_data(db, user, 3, 2)
    other = other_user(db)
    other_id = other.id
    before_other = counts(db, other_id)
    assert before_other == {"users": 1, "sessions": 1, "applications": 3, "interviews": 6}
    uid = user.id
    assert counts(db, uid) == {"users": 1, "sessions": 2, "applications": 3, "interviews": 6}

    r = delete(authed)

    assert r.status_code == 204
    assert r.content == b""
    assert counts(db, uid) == {"users": 0, "sessions": 0, "applications": 0, "interviews": 0}
    assert counts(db, other_id) == before_other


def test_success_clears_cookie_with_matching_attributes(authed):
    r = delete(authed)
    h = r.headers["set-cookie"].lower()
    assert h.startswith(('session_token=""', "session_token=;"))
    assert "max-age=0" in h
    assert "path=/" in h
    assert "httponly" in h
    assert "samesite=lax" in h
    assert "secure" not in h
    assert "domain" not in h


def test_success_cookie_secure_mode(authed, monkeypatch):
    monkeypatch.setattr(config, "COOKIE_SECURE", True)
    authed.cookies.clear()
    authed.cookies.set("__Host-session_token", "tok")
    h = delete(authed).headers["set-cookie"].lower()
    assert h.startswith("__host-session_token=")
    assert "max-age=0" in h and "secure" in h and "path=/" in h and "domain" not in h


def test_wrong_password_403_and_nothing_deleted(authed, db, user):
    add_data(db, user)
    uid = user.id
    before = counts(db, uid)
    r = delete(authed, BAD)
    assert r.status_code == 403
    assert r.json() == {"detail": "Incorrect password."}
    assert "set-cookie" not in r.headers
    assert counts(db, uid) == before


@pytest.mark.parametrize("password", ["", "x" * 73, "é" * 40, USER_PASSWORD + "x" * 80, " " * 200])
def test_odd_passwords_get_the_same_403(authed, db, user, password):
    uid = user.id
    r = delete(authed, password)
    assert r.status_code == 403
    assert r.json() == {"detail": "Incorrect password."}
    assert counts(db, uid)["users"] == 1


def test_missing_password_field_is_422_not_500(authed):
    assert authed.post(URL, json={}).status_code == 422


def test_unauthenticated_401(client, user):
    assert delete(client).status_code == 401


def test_expired_session_401_user_untouched(client, db, user, make_session):
    make_session("old", expires_in=timedelta(seconds=-5))
    as_user(client, "old")
    uid = user.id
    assert delete(client).status_code == 401
    assert counts(db, uid)["users"] == 1


def test_second_delete_with_dead_session_401(authed):
    assert delete(authed).status_code == 204
    authed.cookies.set("session_token", "tok")  # replay the old cookie
    assert delete(authed).status_code == 401
    assert authed.get("/api/v1/me").status_code == 401


def test_other_sessions_of_deleted_user_stop_working(authed, client, make_session):
    make_session("tok-second")
    assert delete(authed).status_code == 204
    as_user(client, "tok-second")
    assert client.get("/api/v1/me").status_code == 401


def test_unauthenticated_attempt_leaves_no_rate_rows(client, db, user):
    delete(client)
    assert db.query(RateLimitEvent).filter(RateLimitEvent.key.like("account-delete:%")).count() == 0


# --- rate limit ---

def test_wrong_password_budget_then_429_with_retry_after(authed):
    for _ in range(config.ACCOUNT_DELETE_USER_LIMIT):
        assert delete(authed, BAD).status_code == 403
    r = delete(authed, BAD)
    assert r.status_code == 429
    assert int(r.headers["retry-after"]) >= 1
    # locked out even for the right password, like login
    assert delete(authed).status_code == 429


def test_correct_password_after_four_wrong_succeeds(authed, db, user):
    for _ in range(config.ACCOUNT_DELETE_USER_LIMIT - 1):
        assert delete(authed, BAD).status_code == 403
    uid = user.id
    assert delete(authed).status_code == 204
    # the correct attempt (and the wrong ones) leave nothing in the user budget
    assert db.query(RateLimitEvent).filter_by(key=f"account-delete:user:{uid}").count() == 0


def test_ip_limit(authed, monkeypatch):
    monkeypatch.setattr(config, "ACCOUNT_DELETE_IP_LIMIT", 2)
    assert delete(authed, BAD).status_code == 403
    assert delete(authed, BAD).status_code == 403
    assert delete(authed, BAD).status_code == 429


def test_login_email_rows_deleted_other_keys_kept(authed, db, user):
    mine = rate_limit.email_key(USER_EMAIL)
    theirs = rate_limit.email_key("someone@else.com")
    for k in (mine, mine, theirs, "login:ip:1.2.3.4"):
        rate_limit.record(db, k)
    db.commit()
    assert delete(authed).status_code == 204
    assert db.query(RateLimitEvent).filter_by(key=mine).count() == 0
    assert db.query(RateLimitEvent).filter_by(key=theirs).count() == 1
    assert db.query(RateLimitEvent).filter_by(key="login:ip:1.2.3.4").count() == 1


# --- invite codes ---

def test_invite_code_stays_used_and_resignup_needs_a_new_code(client, db):
    code = create_invite(db)
    body = {"email": "fresh@example.com", "password": USER_PASSWORD, "account_name": "F", "invite_code": code}
    assert client.post("/api/v1/signup", json=body).status_code == 200
    assert client.post("/api/v1/login", json={"email": "fresh@example.com", "password": USER_PASSWORD}).status_code == 200

    assert delete(client).status_code == 204

    row = db.query(InviteCode).one()
    assert row.used_at is not None
    assert row.used_by_user_id is None
    again = client.post("/api/v1/signup", json=body)  # same email, same (spent) code
    assert again.status_code == 400
    assert again.json() == {"detail": "Invalid or expired invite code."}
    assert db.query(User).filter_by(email="fresh@example.com").count() == 0
    body["invite_code"] = create_invite(db)
    assert client.post("/api/v1/signup", json=body).status_code == 200
    assert db.query(User).filter_by(email="fresh@example.com").count() == 1


# --- scale and failure ---

def test_thousands_of_rows_bounded_statements(authed, db, user):
    add_data(db, user, n_apps=2000, n_interviews=2)
    uid = user.id
    assert counts(db, uid)["interviews"] == 4000
    seen = []
    engine = db.get_bind()

    def count(conn, cursor, statement, params, context, executemany):
        seen.append(statement)

    event.listen(engine, "before_cursor_execute", count)
    try:
        r = delete(authed)
    finally:
        event.remove(engine, "before_cursor_execute", count)
    assert r.status_code == 204
    assert counts(db, uid) == {"users": 0, "sessions": 0, "applications": 0, "interviews": 0}
    assert len(seen) < 25, seen  # constant, not one per row
    assert sum("DELETE FROM job_applications" in s or "DELETE FROM interviews" in s for s in seen) == 0


def test_db_failure_mid_delete_rolls_back_everything_503(authed, db, user):
    add_data(db, user)
    uid = user.id
    rate_limit.record(db, rate_limit.email_key(USER_EMAIL))
    db.commit()
    before = counts(db, uid)
    engine = db.get_bind()

    def boom(conn, cursor, statement, params, context, executemany):
        if statement.startswith("DELETE FROM users"):
            raise OperationalError(statement, params, Exception("db down"))

    event.listen(engine, "before_cursor_execute", boom)
    try:
        r = delete(authed)
    finally:
        event.remove(engine, "before_cursor_execute", boom)
    assert r.status_code == 503
    assert counts(db, uid) == before
    # the email rate rows deleted earlier in the same transaction came back with the rollback
    assert db.query(RateLimitEvent).filter_by(key=rate_limit.email_key(USER_EMAIL)).count() == 1


# --- real concurrency: threads, own connections, committed rows ---
# Helpers and rules (daemon threads, join_all, closing connections in finally, purge on a
# fresh session) are in tests/concurrency.py. lock_timeout (conftest) makes a stuck lock raise.

@pytest.fixture
def real_user():
    """A committed user with two sessions and data; removed (cascade) afterwards, even if the
    test or the setup fails."""
    uid = None
    email = f"race-{uuid.uuid4().hex}@example.com"
    try:
        db = SessionLocal()
        try:
            u = User(email=email, password_hash=hash_password(USER_PASSWORD), account_name="Race")
            db.add(u)
            db.commit()
            uid = u.id
            now = datetime.now(timezone.utc)
            for t in ("race-a", "race-b"):
                db.add(SessionModel(token_hash=hash_session_token(t), user_id=uid, created_at=now, expires_at=now + timedelta(days=1)))
            db.commit()
            add_data(db, u, 5, 2)
        finally:
            db.close()
        yield uid, email
    finally:
        # Requests through a real client commit their rate rows (TestClient's peer is "unknown").
        purge(
            ("DELETE FROM users WHERE id = :i", {"i": uid}),
            (
                "DELETE FROM rate_limit_events WHERE key IN (:a, :b, :c, :d)",
                {
                    "a": f"account-delete:user:{uid}",
                    "b": "account-delete:ip:unknown",
                    "c": "login:ip:unknown",
                    "d": rate_limit.email_key(email),
                },
            ),
        )


def real_client():
    from fastapi.testclient import TestClient

    from app.main import app

    return TestClient(app)


def test_two_simultaneous_deletes_one_204_one_401(real_user):
    uid, _ = real_user
    barrier = threading.Barrier(2)
    out, errors = [], []

    def go(token):
        try:
            with real_client() as c:
                c.cookies.set("session_token", token)
                barrier.wait(timeout=10)
                out.append(c.post(URL, json={"password": USER_PASSWORD}).status_code)
        except Exception as e:  # noqa: BLE001 - a thread would swallow it
            errors.append(e)

    join_all([spawn(go, t) for t in ("race-a", "race-b")])
    assert not errors, errors
    assert sorted(out) == [204, 401], out
    db = SessionLocal()
    try:
        assert counts(db, uid) == {"users": 0, "sessions": 0, "applications": 0, "interviews": 0}
    finally:
        db.close()


def test_login_racing_a_delete_leaves_no_orphan_session(real_user):
    uid, email = real_user
    holder = SessionLocal()
    result = []

    def login():
        with real_client() as c:
            result.append(c.post("/api/v1/login", json={"email": email, "password": USER_PASSWORD}))

    try:
        holder.execute(text("DELETE FROM users WHERE id = :i"), {"i": uid})  # uncommitted: row locked
        t = spawn(login)
        t.join(timeout=1.5)  # login must be blocked on the row lock, not finished
        blocked = t.is_alive()
        holder.commit()
    finally:
        holder.close()  # releases the lock even if an assert fails
    join_all([t])
    assert blocked
    assert [r.status_code for r in result] == [401]
    assert "set-cookie" not in result[0].headers
    db = SessionLocal()
    try:
        assert db.query(SessionModel).filter_by(user_id=uid).count() == 0
    finally:
        db.close()


def test_delete_waiting_on_a_concurrent_delete_gets_401_not_204(real_user):
    """Deterministic version of the race: the 'winner' holds the row lock and then commits
    its delete while our request waits. Without FOR UPDATE the request would reach its own
    DELETE, match 0 rows and answer 204 for an account it did not delete."""
    uid, _ = real_user
    winner = SessionLocal()
    result = []

    def go():
        with real_client() as c:
            c.cookies.set("session_token", "race-a")
            result.append(c.post(URL, json={"password": USER_PASSWORD}))

    try:
        winner.execute(text("SELECT id FROM users WHERE id = :i FOR UPDATE"), {"i": uid})
        t = spawn(go)
        t.join(timeout=1.5)
        blocked = t.is_alive()  # blocked on the lock
        winner.execute(text("DELETE FROM users WHERE id = :i"), {"i": uid})
        winner.commit()
    finally:
        winner.close()  # releases the lock even if an assert fails, so teardown cannot hang
    join_all([t])
    assert blocked
    assert [r.status_code for r in result] == [401]
    assert result[0].json() == {"detail": "Not authenticated"}
    set_cookie = result[0].headers["set-cookie"].lower()  # the loser's cookie is cleared too
    assert set_cookie.startswith("session_token=") and "max-age=0" in set_cookie
