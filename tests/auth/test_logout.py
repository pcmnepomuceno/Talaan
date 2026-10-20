from app.auth.models import Session as SessionModel


def test_logout_valid_token(client, db, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    r = client.post("/logout")
    assert r.status_code == 204
    assert "session_token" in r.headers["set-cookie"]
    assert db.query(SessionModel).filter_by(token="tok").first() is None


def test_logout_no_cookie(client):
    assert client.post("/logout").status_code == 204


def test_logout_bogus_token(client):
    client.cookies.set("session_token", "bogus")
    assert client.post("/logout").status_code == 204


def test_logout_twice(client, make_session):
    make_session("tok")
    client.cookies.set("session_token", "tok")
    assert client.post("/logout").status_code == 204
    client.cookies.set("session_token", "tok")
    assert client.post("/logout").status_code == 204
