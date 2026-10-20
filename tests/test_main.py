import pytest

from tests.conftest import USER_EMAIL, USER_PASSWORD


@pytest.fixture
def logged_in(client, user):
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200
    return client


def test_no_store_on_auth_route(client, user):
    r = client.post("/api/v1/login", json={"email": USER_EMAIL, "password": USER_PASSWORD})
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_me(logged_in):
    r = logged_in.get("/api/v1/me")
    assert r.status_code == 200
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_401(client):
    r = client.get("/api/v1/me")
    assert r.status_code == 401
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_404(logged_in):
    r = logged_in.get("/api/v1/applications/999999")
    assert r.status_code == 404
    assert r.headers["cache-control"] == "no-store"


def test_no_store_on_422(client):
    r = client.post("/api/v1/login", json={})
    assert r.status_code == 422
    assert r.headers["cache-control"] == "no-store"


def test_root_routes_not_touched(client):
    assert "cache-control" not in client.get("/ping").headers
