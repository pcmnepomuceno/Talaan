import pytest

from tests.conftest import USER_EMAIL

GOOD = {"email": "new@example.com", "password": "Str0ng!pass", "account_name": "New"}


def test_signup_success(client):
    r = client.post("/api/v1/signup", json=GOOD)
    assert r.status_code == 200
    body = r.json()
    assert body["email"] == GOOD["email"]
    assert body["account_name"] == "New"
    assert "password" not in body and "password_hash" not in body


def test_signup_duplicate_email(client, user):
    r = client.post("/api/v1/signup", json={**GOOD, "email": USER_EMAIL})
    assert r.status_code == 400


@pytest.mark.parametrize(
    "password",
    [
        "Ab1!x",  # too short
        "str0ng!pass",  # no upper
        "Strong!pass",  # no digit
        "Str0ngpass1",  # no special
        "Aa1!" + "a" * 70,  # 74 bytes
        "Aa1!" + "é" * 35,  # 39 characters but 74 UTF-8 bytes: bytes count, not characters
    ],
)
def test_signup_weak_password(client, password):
    r = client.post("/api/v1/signup", json={**GOOD, "password": password})
    assert r.status_code == 422


def test_signup_stores_normalized_email_and_catches_case_duplicates(client):
    r = client.post("/api/v1/signup", json={**GOOD, "email": "  New@Example.COM "})
    assert r.status_code == 200
    assert r.json()["email"] == "new@example.com"
    assert client.post("/api/v1/signup", json={**GOOD, "email": "NEW@example.com"}).status_code == 400
