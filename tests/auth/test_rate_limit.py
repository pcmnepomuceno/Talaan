"""Login and signup rate limits, end to end through the routes."""

from datetime import timedelta

import pytest
from sqlalchemy.exc import OperationalError

from app import config
from app.auth import rate_limit
from app.auth.models import RateLimitEvent
from app.auth.models import Session as SessionModel
from tests.conftest import USER_EMAIL, USER_PASSWORD

BAD = "Wr0ng!pass"


def login(client, email=USER_EMAIL, password=BAD, xff=None):
    headers = {"X-Forwarded-For": xff} if xff else {}
    return client.post("/api/v1/login", json={"email": email, "password": password}, headers=headers)


def signup(client, i, xff=None):
    headers = {"X-Forwarded-For": xff} if xff else {}
    body = {"email": f"new{i}@example.com", "password": "Str0ng!pass", "account_name": "N"}
    return client.post("/api/v1/signup", json=body, headers=headers)


@pytest.fixture
def trust_proxy(monkeypatch):
    monkeypatch.setattr(config, "TRUST_PROXY", True)


def test_login_ip_limit_hits_on_attempt_11(client):
    for i in range(10):
        assert login(client, f"u{i}@example.com").status_code == 401
    assert login(client, "u99@example.com").status_code == 429


def test_login_email_limit_hits_on_failure_6_even_with_right_password(client, user, trust_proxy):
    for i in range(5):
        assert login(client, xff=f"10.0.0.{i}").status_code == 401  # a new IP every time
    r = login(client, password=USER_PASSWORD, xff="10.0.0.99")
    assert r.status_code == 429


def test_other_email_unaffected_by_a_locked_email(client, user, trust_proxy):
    for i in range(5):
        login(client, xff=f"10.0.0.{i}")
    assert login(client, xff="10.0.1.1").status_code == 429
    assert login(client, "other@example.com", xff="10.0.1.2").status_code == 401


def test_other_ip_unaffected_by_a_blocked_ip(client, trust_proxy):
    for i in range(10):
        login(client, f"u{i}@example.com", xff="7.7.7.7")
    assert login(client, "x@example.com", xff="7.7.7.7").status_code == 429
    assert login(client, "x@example.com", xff="8.8.8.8").status_code == 401


def test_unknown_email_is_limited_too(client, trust_proxy):
    for i in range(5):
        assert login(client, "ghost@example.com", xff=f"10.0.0.{i}").status_code == 401
    assert login(client, "ghost@example.com", xff="10.0.0.50").status_code == 429


def test_success_clears_email_counter(client, user, trust_proxy):
    for i in range(4):
        assert login(client, xff=f"10.0.0.{i}").status_code == 401
    assert login(client, password=USER_PASSWORD, xff="10.0.0.10").status_code == 200
    for i in range(5):  # a fresh budget of 5
        assert login(client, xff=f"10.0.1.{i}").status_code == 401
    assert login(client, xff="10.0.1.99").status_code == 429


def test_successful_logins_count_against_ip_limit(client, user):
    for _ in range(10):
        assert login(client, password=USER_PASSWORD).status_code == 200
    assert login(client, password=USER_PASSWORD).status_code == 429


def test_blocked_attempts_are_not_recorded(client, db):
    for i in range(11):
        login(client, f"u{i}@example.com")
    assert db.query(RateLimitEvent).filter_by(key="login:ip:unknown").count() == 10


def test_window_expiry_with_injected_clock(client, db, monkeypatch):
    for i in range(10):
        login(client, f"u{i}@example.com")
    assert login(client, "x@example.com").status_code == 429
    later = rate_limit.utcnow() + timedelta(seconds=config.LOGIN_IP_WINDOW_SECONDS + 1)
    monkeypatch.setattr(rate_limit, "utcnow", lambda: later)
    assert login(client, "x@example.com").status_code == 401
    assert db.query(RateLimitEvent).filter_by(key="login:ip:unknown").count() == 1  # old rows pruned


def test_429_shape_is_the_same_for_ip_and_email_limits(client, user, trust_proxy):
    for i in range(5):
        login(client, xff=f"10.0.0.{i}")
    by_email = login(client, xff="10.9.9.9")
    for i in range(10):
        login(client, f"u{i}@example.com", xff="6.6.6.6")
    by_ip = login(client, "z@example.com", xff="6.6.6.6")
    for r in (by_email, by_ip):
        assert r.status_code == 429
        assert 1 <= int(r.headers["retry-after"]) <= config.LOGIN_IP_WINDOW_SECONDS
        assert r.headers["cache-control"] == "no-store"
    assert by_email.json() == by_ip.json() == {"detail": "Too many attempts. Try again later."}


def test_spoofed_xff_ignored_when_proxy_not_trusted(client):
    for i in range(10):
        login(client, f"u{i}@example.com", xff=f"10.0.0.{i}")
    assert login(client, "x@example.com", xff="10.0.9.9").status_code == 429


def test_rightmost_xff_is_the_key_when_trusted(client, monkeypatch, trust_proxy):
    monkeypatch.setattr(config, "LOGIN_IP_LIMIT", 2)
    assert login(client, "a@example.com", xff="1.1.1.1, 2.2.2.2").status_code == 401
    assert login(client, "b@example.com", xff="3.3.3.3, 2.2.2.2").status_code == 401
    assert login(client, "c@example.com", xff="4.4.4.4, 2.2.2.2").status_code == 429
    assert login(client, "c@example.com", xff="2.2.2.2, 4.4.4.4").status_code == 401


def test_signup_ip_limit_hits_on_attempt_6(client):
    for i in range(5):
        assert signup(client, i).status_code == 200
    assert signup(client, 99).status_code == 429


def test_signup_and_login_limits_are_separate_buckets(client):
    for i in range(10):
        login(client, f"u{i}@example.com")
    assert signup(client, 1).status_code == 200


def test_table_never_holds_a_raw_email(client, db, user):
    login(client, "  MiXed@Example.COM ")
    login(client, USER_EMAIL, password=USER_PASSWORD)
    signup(client, 1)
    keys = [e.key for e in db.query(RateLimitEvent)]
    assert keys
    assert all("@" not in k and "example" not in k.lower() for k in keys)
    assert rate_limit.email_key("mixed@example.com") in keys  # case and padding: one key


def test_very_long_email_is_rejected_not_a_500(client):
    assert login(client, "a" * 10_000 + "@example.com").status_code == 422


def test_limiter_db_error_fails_closed_with_503(client, db, user, monkeypatch):
    def boom(*a, **k):
        raise OperationalError("select", {}, Exception("db down"))

    monkeypatch.setattr(rate_limit, "check", boom)
    r = login(client, password=USER_PASSWORD)
    assert r.status_code == 503
    assert db.query(SessionModel).count() == 0
    assert "session_token" not in r.headers.get("set-cookie", "")
    assert signup(client, 1).status_code == 503


def test_ip_and_email_attempts_are_committed_before_bcrypt_runs(client, db, user, monkeypatch):
    from app.auth import router

    seen = {}

    def spy(password, hashed):
        seen["pending"] = bool(db.new or db.dirty or db.deleted)
        seen["ip"] = db.query(RateLimitEvent).filter_by(key="login:ip:unknown").count()
        seen["email"] = db.query(RateLimitEvent).filter_by(key=rate_limit.email_key(USER_EMAIL)).count()
        return False

    monkeypatch.setattr(router, "verify_password", spy)
    login(client)
    assert seen == {"pending": False, "ip": 1, "email": 1}


def test_concurrent_guesses_all_recorded_before_verify_hit_429_at_the_limit(client, db, user, monkeypatch):
    """Each verify starts the next attempt before returning, so every attempt has passed the
    limiter before any bcrypt finishes: the worst case for concurrent guesses."""
    from app.auth import router

    statuses, verifies = [], []

    def nested(password, hashed):
        verifies.append(1)
        statuses.append(login(client).status_code)  # stops at the first 429 (no verify there)
        return False

    monkeypatch.setattr(router, "verify_password", nested)
    statuses.append(login(client).status_code)
    # 5 attempts reach verify; the 6th, sent while all 5 are still "in bcrypt", gets 429.
    assert len(verifies) == config.LOGIN_EMAIL_LIMIT
    assert sorted(statuses) == [401] * config.LOGIN_EMAIL_LIMIT + [429]
    assert db.query(RateLimitEvent).filter_by(key=rate_limit.email_key(USER_EMAIL)).count() == 5
