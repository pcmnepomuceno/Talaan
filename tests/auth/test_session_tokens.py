from datetime import datetime, timedelta, timezone

import pytest

from app.auth.models import Session as SessionModel
from app.auth.security import hash_session_token
from tests.conftest import USER_EMAIL, USER_PASSWORD

LOGIN = {"email": USER_EMAIL, "password": USER_PASSWORD}


def _login(client):
    r = client.post("/api/v1/login", json=LOGIN)
    assert r.status_code == 200
    return r, r.cookies["session_token"]


def test_login_stores_only_the_hash(client, db, user):
    r, raw = _login(client)
    assert r.json() == {"detail": "Logged in"}
    assert raw not in r.text
    row = db.query(SessionModel).one()
    assert raw not in [str(getattr(row, c.name)) for c in SessionModel.__table__.columns]
    assert row.token_hash == hash_session_token(raw)


def test_login_cookie_flags_unchanged(client, user):
    r, _ = _login(client)
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie
    assert "max-age=2592000" in cookie
    assert "secure" not in cookie
    assert "samesite=lax" in cookie  # Starlette default, unchanged


def test_cookie_authenticates_and_one_char_change_fails(client, user):
    _, raw = _login(client)
    assert client.get("/api/v1/me").status_code == 200
    ok = client.get("/api/v1/me")
    flipped = raw[:-1] + ("A" if raw[-1] != "A" else "B")
    client.cookies.set("session_token", flipped)
    bad = client.get("/api/v1/me")
    assert bad.status_code == 401
    client.cookies.set("session_token", "bogus")
    unknown = client.get("/api/v1/me")
    assert (bad.status_code, bad.json()) == (unknown.status_code, unknown.json())
    assert ok.json()["email"] == USER_EMAIL


def test_logout_deletes_row_and_cookie_then_fails(client, db, user):
    _, raw = _login(client)
    assert client.post("/api/v1/logout").status_code == 204
    assert db.query(SessionModel).count() == 0
    client.cookies.set("session_token", raw)
    assert client.get("/api/v1/me").status_code == 401


def test_two_logins_are_independent(client, db, user):
    _, first = _login(client)
    client.cookies.clear()
    _, second = _login(client)
    assert first != second
    hashes = {s.token_hash for s in db.query(SessionModel).all()}
    assert hashes == {hash_session_token(first), hash_session_token(second)}
    client.cookies.set("session_token", first)
    assert client.post("/api/v1/logout").status_code == 204
    client.cookies.set("session_token", second)
    assert client.get("/api/v1/me").status_code == 200


def test_expired_session_is_401_and_deleted(client, db, user):
    _, raw = _login(client)
    db.query(SessionModel).update(
        {"expires_at": datetime.now(timezone.utc) - timedelta(seconds=1)}
    )
    db.commit()
    client.cookies.set("session_token", raw)
    r = client.get("/api/v1/me")
    assert (r.status_code, r.json()) == (401, {"detail": "Session expired"})
    assert db.query(SessionModel).count() == 0


@pytest.mark.parametrize("value", ["", "x" * 10_000, "a%b!~*'()"])
def test_odd_cookie_values_never_500(client, value):
    client.cookies.set("session_token", value)
    assert client.get("/api/v1/me").status_code == 401
    assert client.post("/api/v1/logout").status_code == 204


def test_non_ascii_cookie_bytes_never_500(client):
    headers = {"cookie": b"session_token=caf\xe9"}
    assert client.get("/api/v1/me", headers=headers).status_code == 401
    assert client.post("/api/v1/logout", headers=headers).status_code == 204
