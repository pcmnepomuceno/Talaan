import logging
from datetime import timedelta

import pytest

from app import config
from app.auth import invites
from app.auth.models import InviteCode
from app.users.models import User
from tests.conftest import USER_EMAIL, create_invite

GOOD = {"email": "new@example.com", "password": "Str0ng!pass", "account_name": "New"}
GENERIC = {"detail": "Invalid or expired invite code."}


def body(db, **over):
    """A valid signup body with a fresh valid code, overridable per test."""
    return {**GOOD, "invite_code": create_invite(db), **over}


def invite_row(db, code):
    db.expire_all()
    return db.query(InviteCode).filter_by(code_hash=invites.hash_code(invites.normalize(code))).one()


def test_signup_success(client, db):
    r = client.post("/api/v1/signup", json=body(db))
    assert r.status_code == 200
    out = r.json()
    assert out["email"] == GOOD["email"]
    assert out["account_name"] == "New"
    assert "password" not in out and "password_hash" not in out and "invite_code" not in out


def test_valid_code_creates_user_and_is_consumed(client, db):
    code = create_invite(db)
    r = client.post("/api/v1/signup", json=body(db, invite_code=code))
    assert r.status_code == 200
    row = invite_row(db, code)
    assert row.used_at is not None
    assert row.used_by_user_id == r.json()["id"]


def test_same_code_twice_second_gets_generic_400(client, db):
    code = create_invite(db)
    assert client.post("/api/v1/signup", json=body(db, invite_code=code)).status_code == 200
    r = client.post("/api/v1/signup", json=body(db, invite_code=code, email="other@example.com"))
    assert (r.status_code, r.json()) == (400, GENERIC)
    assert db.query(User).filter_by(email="other@example.com").count() == 0


def test_signup_without_invite_code_is_422(client):
    assert client.post("/api/v1/signup", json=GOOD).status_code == 422


def bad_codes(db, user):
    return {
        "unknown": "TLN-0000-0000-0000",
        "expired": create_invite(db, expires_in=timedelta(seconds=-1)),
        "used": create_invite(db, used_by=user),
        "malformed_chars": "TLN-IIII-LLLL-OOOO",
        "right_length_bad_char": "TLN-ABCD-2345-EFGU",
        "too_short": "TLN-ABCD",
        "over_length": "TLN-" + "A" * 200,
        "empty": "",
    }


def test_every_bad_code_gives_identical_response(client, db, user, monkeypatch):
    monkeypatch.setattr(config, "SIGNUP_IP_LIMIT", 100)
    seen = {}
    for name, code in bad_codes(db, user).items():
        r = client.post("/api/v1/signup", json={**GOOD, "email": f"{name}@example.com", "invite_code": code})
        headers = {k: v for k, v in r.headers.items() if k != "date"}
        seen[name] = (r.status_code, r.json(), headers)
        assert db.query(User).filter_by(email=f"{name}@example.com").count() == 0
    first = next(iter(seen.values()))
    assert first[:2] == (400, GENERIC)
    assert all(v == first for v in seen.values()), seen


def test_lowercase_padded_crlf_code_signs_up(client, db):
    code = create_invite(db)
    messy = f"  {code.lower()}\r\n"
    assert client.post("/api/v1/signup", json=body(db, invite_code=messy)).status_code == 200
    assert invite_row(db, code).used_at is not None


def test_duplicate_email_with_valid_code_leaves_code_unused(client, db, user):
    code = create_invite(db)
    r = client.post("/api/v1/signup", json=body(db, invite_code=code, email=USER_EMAIL))
    assert (r.status_code, r.json()) == (400, {"detail": "Email already exists."})
    row = invite_row(db, code)
    assert row.used_at is None and row.used_by_user_id is None


def test_duplicate_email_with_invalid_code_never_reveals_email(client, db, user):
    r = client.post("/api/v1/signup", json=body(db, invite_code="TLN-0000-0000-0000", email=USER_EMAIL))
    assert (r.status_code, r.json()) == (400, GENERIC)


def test_validation_failure_with_valid_code_leaves_code_unused(client, db):
    code = create_invite(db)
    r = client.post("/api/v1/signup", json=body(db, invite_code=code, password="weak"))
    assert r.status_code == 422
    assert invite_row(db, code).used_at is None
    assert db.query(User).filter_by(email=GOOD["email"]).count() == 0


def test_code_is_valid_strictly_before_expires_at(client, db, monkeypatch):
    monkeypatch.setattr(config, "SIGNUP_IP_LIMIT", 100)
    code_a, code_b = create_invite(db), create_invite(db)
    expires = invite_row(db, code_a).expires_at
    invite_row(db, code_b).expires_at = expires
    db.commit()
    monkeypatch.setattr(invites, "utcnow", lambda: expires)  # exactly at expiry: invalid
    r = client.post("/api/v1/signup", json=body(db, invite_code=code_a))
    assert (r.status_code, r.json()) == (400, GENERIC)
    monkeypatch.setattr(invites, "utcnow", lambda: expires - timedelta(microseconds=1))
    assert client.post("/api/v1/signup", json=body(db, invite_code=code_b)).status_code == 200


def test_bad_codes_count_against_the_signup_ip_limit(client, db):
    for i in range(config.SIGNUP_IP_LIMIT):
        r = client.post("/api/v1/signup", json={**GOOD, "invite_code": "TLN-0000-0000-0000"})
        assert r.status_code == 400
    assert client.post("/api/v1/signup", json=body(db)).status_code == 429


def test_code_and_hash_never_in_logs_or_responses(client, db, caplog):
    caplog.set_level(logging.DEBUG)
    good, bad = create_invite(db), "TLN-0000-0000-0000"
    secrets_ = [good, invites.normalize(good), invites.hash_code(invites.normalize(good)),
                bad, invites.normalize(bad), invites.hash_code(invites.normalize(bad))]
    texts = []
    for code, email in ((good, "ok@example.com"), (bad, "bad@example.com"), (good, "again@example.com")):
        r = client.post("/api/v1/signup", json=body(db, invite_code=code, email=email))
        texts.append(r.text + str(dict(r.headers)))
    texts.append(caplog.text)
    for secret in secrets_:
        assert not any(secret in t for t in texts)


def test_deleting_the_user_nulls_used_by_but_keeps_code_used(client, db):
    code = create_invite(db)
    uid = client.post("/api/v1/signup", json=body(db, invite_code=code)).json()["id"]
    db.query(User).filter_by(id=uid).delete()
    db.commit()
    row = invite_row(db, code)
    assert row.used_by_user_id is None
    assert row.used_at is not None


def test_signup_duplicate_email(client, db, user):
    r = client.post("/api/v1/signup", json=body(db, email=USER_EMAIL))
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
def test_signup_weak_password(client, db, password):
    r = client.post("/api/v1/signup", json=body(db, password=password))
    assert r.status_code == 422


def test_signup_stores_normalized_email_and_catches_case_duplicates(client, db):
    r = client.post("/api/v1/signup", json=body(db, email="  New@Example.COM "))
    assert r.status_code == 200
    assert r.json()["email"] == "new@example.com"
    assert client.post("/api/v1/signup", json=body(db, email="NEW@example.com")).status_code == 400
