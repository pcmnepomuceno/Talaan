from tests.conftest import USER_EMAIL, USER_PASSWORD


def test_login_success(client, user):
    r = client.post("/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200
    assert r.json() == {"detail": "Logged in"}
    assert client.cookies.get("session_token")
    assert "httponly" in r.headers["set-cookie"].lower()


def test_login_unknown_email(client):
    r = client.post("/login", json={"email": "no@example.com", "password": USER_PASSWORD})
    assert r.status_code == 401


def test_login_wrong_password(client, user):
    r = client.post("/login", json={"email": USER_EMAIL, "password": "Wr0ng!pass"})
    assert r.status_code == 401


def test_login_failures_are_indistinguishable(client, user):
    a = client.post("/login", json={"email": "no@example.com", "password": USER_PASSWORD})
    b = client.post("/login", json={"email": USER_EMAIL, "password": "Wr0ng!pass"})
    assert a.json() == b.json()
