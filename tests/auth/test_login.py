import pytest
from sqlalchemy.exc import IntegrityError

from app.auth.models import Session as SessionModel
from tests.conftest import USER_EMAIL, USER_PASSWORD


def test_login_success(client, user):
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200
    assert r.json() == {"detail": "Logged in"}
    assert client.cookies.get("session_token")
    assert "httponly" in r.headers["set-cookie"].lower()


def test_login_unknown_email(client):
    r = client.post("/api/v1/login", json={"email": "no@example.com", "password": USER_PASSWORD})
    assert r.status_code == 401


def test_login_wrong_password(client, user):
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": "Wr0ng!pass"})
    assert r.status_code == 401


def test_login_failures_are_indistinguishable(client, user):
    a = client.post("/api/v1/login", json={"email": "no@example.com", "password": USER_PASSWORD})
    b = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": "Wr0ng!pass"})
    assert a.json() == b.json()


def test_login_email_ignores_case_and_padding(client, user):
    r = client.post("/api/v1/login", json={"email": "  " + USER_EMAIL.upper() + " ", "password": USER_PASSWORD})
    assert r.status_code == 200


class _PgError(Exception):
    def __init__(self, pgcode):
        super().__init__(f"sqlstate {pgcode}")
        self.pgcode = pgcode


def _fail_session_commit(db, monkeypatch, pgcode):
    """Make the commit that carries the new session row raise IntegrityError with pgcode."""
    real_commit = db.commit

    def commit():
        if any(isinstance(o, SessionModel) for o in db.new):
            raise IntegrityError("INSERT INTO sessions ...", {}, _PgError(pgcode))
        real_commit()

    monkeypatch.setattr(db, "commit", commit)


def test_login_fk_violation_on_session_insert_is_401(client, db, user, monkeypatch):
    _fail_session_commit(db, monkeypatch, "23503")
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 401
    assert r.json() == {"detail": "Invalid email or password."}
    assert "set-cookie" not in r.headers


def test_login_other_integrity_error_on_session_insert_propagates(client, db, user, monkeypatch):
    _fail_session_commit(db, monkeypatch, "23505")  # unique violation: a bug, not a deleted user
    with pytest.raises(IntegrityError):
        client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
