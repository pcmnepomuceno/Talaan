"""Unknown email and wrong password must be indistinguishable and do the same work."""

import pytest

from app.auth import router
from app.auth.security import DUMMY_PASSWORD_HASH, hash_password, verify_password
from tests.conftest import USER_EMAIL, USER_PASSWORD


@pytest.fixture
def verify_calls(monkeypatch):
    calls = []

    def spy(password, hashed):
        calls.append(hashed)
        return verify_password(password, hashed)

    monkeypatch.setattr(router, "verify_password", spy)
    return calls


def _post(client, email, password):
    return client.post("/api/v1/login", json={"email": email, "password": password})


def test_unknown_email_and_wrong_password_responses_are_identical(client, user):
    a = _post(client, "no@example.com", USER_PASSWORD)
    b = _post(client, USER_EMAIL, "Wr0ng!pass")
    assert a.status_code == b.status_code == 401
    assert a.content == b.content
    strip = lambda r: {k: v for k, v in r.headers.items() if k != "date"}
    assert strip(a) == strip(b)


def test_one_verification_per_path(client, user, verify_calls):
    _post(client, "no@example.com", USER_PASSWORD)
    assert verify_calls == [DUMMY_PASSWORD_HASH]
    verify_calls.clear()
    _post(client, USER_EMAIL, "Wr0ng!pass")
    assert len(verify_calls) == 1 and verify_calls[0] != DUMMY_PASSWORD_HASH
    verify_calls.clear()
    assert _post(client, USER_EMAIL, USER_PASSWORD).status_code == 200
    assert len(verify_calls) == 1


def test_dummy_hash_matches_real_hash_format():
    assert DUMMY_PASSWORD_HASH[:7] == hash_password("x")[:7]  # algorithm and cost


@pytest.mark.parametrize("email", [USER_EMAIL, "no@example.com"])
def test_password_over_72_bytes_is_401_not_500(client, user, email):
    assert _post(client, email, "Aa1!" + "a" * 80).status_code == 401


def test_first_72_bytes_never_authenticate(client, db, user):
    # A real 72-byte password: the same password plus junk must not match by truncation.
    pw = "Aa1!" + "b" * 68
    user.password_hash = hash_password(pw)
    db.commit()
    assert _post(client, USER_EMAIL, pw).status_code == 200
    assert _post(client, USER_EMAIL, pw + "junk").status_code == 401
