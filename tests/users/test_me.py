from datetime import timedelta

from app.models import Session as SessionModel
from tests.conftest import USER_EMAIL


def test_me_valid_session(client, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    r = client.get("/me")
    assert r.status_code == 200
    assert r.json()["email"] == USER_EMAIL


def test_me_no_cookie(client):
    assert client.get("/me").status_code == 401


def test_me_bogus_token(client):
    client.cookies.set("session_token", "bogus")
    assert client.get("/me").status_code == 401


def test_me_expired_session_deleted(client, db, make_session):
    make_session("old", expires_in=timedelta(seconds=-1))
    client.cookies.set("session_token", "old")
    assert client.get("/me").status_code == 401
    assert db.query(SessionModel).filter_by(token="old").first() is None


def test_me_after_logout(client, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    assert client.post("/logout").status_code == 204
    client.cookies.set("session_token", "tok")
    assert client.get("/me").status_code == 401
