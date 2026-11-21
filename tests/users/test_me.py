from datetime import timedelta

from app import config
from app.auth.models import Session as SessionModel
from app.auth.security import hash_session_token
from tests.conftest import USER_EMAIL


def test_me_valid_session(client, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    r = client.get("/api/v1/me")
    assert r.status_code == 200
    assert r.json()["email"] == USER_EMAIL


def test_me_no_cookie(client):
    assert client.get("/api/v1/me").status_code == 401


def test_me_bogus_token(client):
    client.cookies.set("session_token", "bogus")
    assert client.get("/api/v1/me").status_code == 401


def test_me_expired_session_deleted(client, db, make_session):
    make_session("old", expires_in=timedelta(seconds=-1))
    client.cookies.set("session_token", "old")
    assert client.get("/api/v1/me").status_code == 401
    assert db.query(SessionModel).filter_by(token_hash=hash_session_token("old")).first() is None


def test_me_after_logout(client, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    assert client.post("/api/v1/logout").status_code == 204
    client.cookies.set("session_token", "tok")
    assert client.get("/api/v1/me").status_code == 401


def test_me_is_admin_true_for_listed_email(client, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    make_session("tok")
    client.cookies.set("session_token", "tok")
    assert client.get("/api/v1/me").json()["is_admin"] is True


def test_me_is_admin_matches_case_insensitively(client, db, user, make_session, monkeypatch):
    user.email = "User@Example.COM"  # stored mixed case; the setting is always lowercase
    db.commit()
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    make_session("tok")
    client.cookies.set("session_token", "tok")
    assert client.get("/api/v1/me").json()["is_admin"] is True


def test_me_is_admin_false_when_not_listed_or_unset(client, make_session, monkeypatch):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset())
    assert client.get("/api/v1/me").json()["is_admin"] is False
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"someone-else@example.ph"}))
    assert client.get("/api/v1/me").json()["is_admin"] is False
