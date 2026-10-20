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
    ],
)
def test_signup_weak_password(client, password):
    r = client.post("/api/v1/signup", json={**GOOD, "password": password})
    assert r.status_code == 422
