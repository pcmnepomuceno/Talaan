import pytest

from app import config
from app.auth.router import SESSION_LIFETIME
from tests.conftest import USER_EMAIL, USER_PASSWORD

MAX_AGE = int(SESSION_LIFETIME.total_seconds())


def attrs(header: str) -> dict:
    """Parse a raw Set-Cookie header into {name: value, flag: True, ...} (lowercased keys)."""
    parts = [p.strip() for p in header.split(";")]
    name, _, value = parts[0].partition("=")
    out = {"name": name, "value": value}
    for p in parts[1:]:
        k, _, v = p.partition("=")
        out[k.lower()] = v or True
    return out


def login(client):
    return client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})


@pytest.mark.parametrize("secure", [True, False])
def test_login_cookie_attributes(client, user, monkeypatch, secure):
    monkeypatch.setattr(config, "COOKIE_SECURE", secure)
    r = login(client)
    assert r.status_code == 200
    a = attrs(r.headers["set-cookie"])
    assert a["name"] == ("__Host-session_token" if secure else "session_token")
    assert a["httponly"] is True
    assert a["samesite"].lower() == "lax"
    assert a["path"] == "/"
    assert a["max-age"] == str(MAX_AGE)
    assert ("secure" in a) is secure
    assert "domain" not in a


@pytest.mark.parametrize("secure", [True, False])
def test_logout_clears_with_same_attributes(client, monkeypatch, secure):
    monkeypatch.setattr(config, "COOKIE_SECURE", secure)
    r = client.post("/api/v1/logout")
    assert r.status_code == 204
    a = attrs(r.headers["set-cookie"])
    assert a["name"] == ("__Host-session_token" if secure else "session_token")
    assert a["value"] in ("", '""')
    assert a["max-age"] == "0"
    assert a["httponly"] is True
    assert a["samesite"].lower() == "lax"
    assert a["path"] == "/"
    assert ("secure" in a) is secure
    assert "domain" not in a


def test_no_samesite_none_anywhere(client, user):
    assert "none" not in login(client).headers["set-cookie"].lower()


@pytest.mark.parametrize("secure", [True, False])
def test_me_reads_the_cookie_name_of_the_current_mode(client, make_session, monkeypatch, secure):
    monkeypatch.setattr(config, "COOKIE_SECURE", secure)
    make_session("tok")
    right, wrong = ("__Host-session_token", "session_token") if secure else ("session_token", "__Host-session_token")
    client.cookies.set(wrong, "tok")
    assert client.get("/api/v1/me").status_code == 401
    client.cookies.clear()
    client.cookies.set(right, "tok")
    assert client.get("/api/v1/me").status_code == 200
