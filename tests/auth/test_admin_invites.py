import logging
import threading
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy.exc import DataError, OperationalError

from app import config
from app.auth import admin_invites, invites
from app.auth.models import InviteCode, RateLimitEvent
from app.auth.models import Session as SessionModel
from app.auth.security import hash_password, hash_session_token
from app.database import SessionLocal
from app.main import app
from app.users.models import User
from tests.concurrency import join_all, purge, spawn
from tests.conftest import USER_EMAIL, USER_PASSWORD, as_user, create_invite

URL = "/api/v1/admin/invites"


def parse_admins(raw):
    """The same expression app/config.py uses for ADMIN_EMAILS."""
    return frozenset(e.strip().lower() for e in (raw or "").split(",") if e.strip())


@pytest.fixture
def admin(client, db, user, make_session, monkeypatch):
    """`user` is an admin with a session; the client is logged in as them."""
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins(USER_EMAIL))
    make_session("tok")
    as_user(client, "tok")
    return client


def friend(db, name="Ana Cruz", email="ana@example.ph"):
    u = User(email=email, password_hash="x", account_name=name)
    db.add(u)
    db.commit()
    return u


# --- gating ---

def test_anonymous_gets_401_on_list_and_revoke(client, user, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins(USER_EMAIL))
    assert client.get(URL).status_code == 401
    assert client.delete(f"{URL}/1").status_code == 401
    assert client.get(URL).headers["cache-control"] == "no-store"


def test_non_admin_gets_404_on_list_and_revoke(client, db, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins("someone-else@example.ph"))
    make_session("tok")
    as_user(client, "tok")
    r = client.get(URL)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert r.headers["cache-control"] == "no-store"
    assert client.delete(f"{URL}/1").status_code == 404


def test_non_admin_gets_404_before_validation_runs(client, db, user, make_session, monkeypatch):
    """The gate runs before body and path validation, so a non-admin learns nothing from a 422."""
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins("someone-else@example.ph"))
    make_session("tok")
    as_user(client, "tok")
    for r in (client.post(URL, json={}), client.delete(f"{URL}/abc")):
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}


def test_empty_admin_emails_means_404_for_everyone(client, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins(""))
    make_session("tok")
    as_user(client, "tok")
    assert client.get(URL).status_code == 404
    assert client.delete(f"{URL}/1").status_code == 404


def test_admin_emails_with_spaces_commas_and_case_still_matches(client, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins("  Other@Example.PH , ,USER@Example.com,, "))
    make_session("tok")
    as_user(client, "tok")
    assert client.get(URL).status_code == 200


# --- list ---

def test_list_is_newest_first_with_status_and_used_by(admin, db, user):
    ana = friend(db)
    create_invite(db, note="old unused")
    create_invite(db, expires_in=timedelta(days=-1), note="gone stale")
    create_invite(db, note="taken", used_by=ana)
    r = admin.get(URL)
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["note"] for i in items] == ["taken", "gone stale", "old unused"]
    assert [i["status"] for i in items] == ["used", "expired", "unused"]
    assert [i["id"] for i in items] == sorted((i["id"] for i in items), reverse=True)
    assert items[0]["used_by_account_name"] == "Ana Cruz" and items[0]["used_at"]
    assert items[1]["used_at"] is None and items[1]["used_by_account_name"] is None
    assert set(items[0]) == {"id", "status", "note", "created_at", "expires_at", "used_at", "used_by_account_name"}


def test_list_empty(admin):
    assert admin.get(URL).json() == {"items": []}


def test_deleted_user_gives_null_name_with_used_at_set(admin, db):
    ana = friend(db)
    create_invite(db, note="taken", used_by=ana)
    db.query(User).filter(User.id == ana.id).delete(synchronize_session=False)
    db.commit()
    db.expire_all()
    (item,) = admin.get(URL).json()["items"]
    assert item["status"] == "used" and item["used_at"] is not None
    assert item["used_by_account_name"] is None


def test_raw_list_text_has_no_code_hash_or_email(admin, db):
    ana = friend(db, name="Ana Cruz")
    codes = [create_invite(db, note="a"), create_invite(db, note="b", used_by=ana)]
    hashes = [h for (h,) in db.query(InviteCode.code_hash).all()]
    text = admin.get(URL).text
    assert "TLN-" not in text and "@" not in text
    assert len(hashes) == 2 and not any(h in text for h in hashes)
    assert not any(c in text for c in codes)
    assert "code" not in text.replace("used_by_account_name", "")  # no code/code_hash keys


# --- revoke ---

def test_revoke_unused_is_204_and_gone(admin, db):
    create_invite(db)
    invite_id = db.query(InviteCode.id).scalar()
    r = admin.delete(f"{URL}/{invite_id}")
    assert r.status_code == 204 and r.content == b""
    assert db.query(InviteCode).count() == 0


def test_revoke_used_is_409_and_stays(admin, db):
    create_invite(db, used_by=friend(db))
    invite_id = db.query(InviteCode.id).scalar()
    r = admin.delete(f"{URL}/{invite_id}")
    assert r.status_code == 409
    assert r.json() == {"detail": "This invite has been used and cannot be revoked."}
    assert db.query(InviteCode).count() == 1


@pytest.mark.parametrize("invite_id", ["999999", "99999999999999999999", "-1"])
def test_revoke_missing_is_404(admin, invite_id):
    r = admin.delete(f"{URL}/{invite_id}")
    assert r.status_code == 404 and r.json() == {"detail": "Invite not found."}


def test_cache_control_no_store_on_every_outcome(admin, db):
    create_invite(db)
    create_invite(db, used_by=friend(db))
    ids = [i for (i,) in db.query(InviteCode.id).order_by(InviteCode.id)]
    responses = [
        admin.get(URL),  # 200
        admin.delete(f"{URL}/{ids[1]}"),  # 409
        admin.delete(f"{URL}/999999"),  # 404
        admin.delete(f"{URL}/{ids[0]}"),  # 204
    ]
    assert [r.status_code for r in responses] == [200, 409, 404, 204]
    assert all(r.headers["cache-control"] == "no-store" for r in responses)


def test_create_outcomes_403_409_429_are_no_store(admin, db, monkeypatch):
    responses = [create(admin, password=BAD)]  # 403
    fill(db, unused=50)
    responses.append(create(admin))  # 409
    monkeypatch.setattr(config, "ADMIN_INVITE_USER_LIMIT", 1)
    responses.append(create(admin))  # 429
    assert [r.status_code for r in responses] == [403, 409, 429]
    assert all(r.headers["cache-control"] == "no-store" for r in responses)


# --- create ---

BAD = "Wr0ng!pass"
CAP_MESSAGE = "There are already 50 unused invites. Revoke one or wait for one to expire."


def create(client, password=USER_PASSWORD, expires_in_days=14, **body):
    return client.post(URL, json={"expires_in_days": expires_in_days, "password": password, **body})


def fill(db, unused=0, expired=0, used=0):
    """Insert invites in bulk (no commit per row). Used ones have no user: the SET NULL shape."""
    now = datetime.now(timezone.utc)
    kinds = [(None, 1)] * unused + [(None, -1)] * expired + [(now, 1)] * used
    for used_at, sign in kinds:
        _, code_hash = invites.generate()
        db.add(InviteCode(code_hash=code_hash, created_at=now, expires_at=now + sign * timedelta(days=1), used_at=used_at))
    db.commit()


def test_anonymous_gets_401_on_create(client, user, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins(USER_EMAIL))
    r = create(client)
    assert r.status_code == 401 and r.headers["cache-control"] == "no-store"


def test_non_admin_gets_404_on_create_and_nothing_is_made(client, db, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins("someone-else@example.ph"))
    make_session("tok")
    as_user(client, "tok")
    r = create(client)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert r.headers["cache-control"] == "no-store"
    assert db.query(InviteCode).count() == 0
    assert db.query(RateLimitEvent).count() == 0  # not even a rate-limit row


def test_created_code_works_in_real_signup_exactly_once(admin, db):
    r = create(admin, note="Friend one")
    assert r.status_code == 201
    code = r.json()["code"]
    signup = {"email": "friend@example.ph", "password": "Str0ng!pass", "account_name": "Friend", "invite_code": code}
    assert admin.post("/api/v1/signup", json=signup).status_code == 200
    again = admin.post("/api/v1/signup", json={**signup, "email": "second@example.ph"})
    assert again.status_code == 400
    assert again.json() == {"detail": "Invalid or expired invite code."}
    as_user(admin, "tok")
    (item,) = admin.get(URL).json()["items"]
    assert item["status"] == "used" and item["used_by_account_name"] == "Friend"


def test_create_response_shape_and_no_store(admin):
    r = create(admin, note="Friend one", expires_in_days=7)
    assert r.status_code == 201
    body = r.json()
    assert set(body) == {"id", "code", "note", "expires_at"}
    assert body["note"] == "Friend one" and body["code"].startswith("TLN-")
    assert r.headers["cache-control"] == "no-store"
    assert "set-cookie" not in r.headers


def test_code_is_absent_from_later_list_and_from_every_log(admin, db, caplog):
    """Limit: the `db` fixture was built before the log level is set, and SQL statement logging is
    off by default, so this proves the app's own logs never carry the code. The stored value is the
    hash, never the plaintext code (asserted below)."""
    caplog.set_level(logging.DEBUG)  # root logger: every logger propagates here
    r = create(admin, note="log check")
    assert r.status_code == 201
    code = r.json()["code"]
    body = code.replace("-", "")[3:]
    code_hash = db.query(InviteCode.code_hash).scalar()
    assert code_hash == invites.hash_code(body)
    listing = admin.get(URL).text
    assert code not in listing and body not in listing and code_hash not in listing
    for secret in (code, body, code_hash):
        assert secret not in caplog.text


def test_wrong_password_is_403_and_creates_nothing(admin, db):
    r = create(admin, password=BAD)
    assert r.status_code == 403 and r.json() == {"detail": "Incorrect password."}
    assert db.query(InviteCode).count() == 0


def test_user_limit_trips_with_retry_after(admin, db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_INVITE_USER_LIMIT", 2)
    assert create(admin).status_code == 201
    assert create(admin).status_code == 201  # successful attempts count too
    r = create(admin)
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert db.query(InviteCode).count() == 2  # blocked before the password and the insert


def test_ip_limit_trips_with_retry_after(admin, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_INVITE_IP_LIMIT", 2)
    assert create(admin, password=BAD).status_code == 403
    assert create(admin, password=BAD).status_code == 403
    r = create(admin, password=BAD)
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1


def test_cap_50_unused_is_409_and_creates_nothing(admin, db):
    fill(db, unused=50)
    r = create(admin)
    assert r.status_code == 409 and r.json() == {"detail": CAP_MESSAGE}
    assert db.query(InviteCode).count() == 50


def test_expired_and_used_do_not_count_toward_the_cap(admin, db):
    fill(db, unused=49, expired=4, used=4)
    assert create(admin).status_code == 201
    assert create(admin).status_code == 409  # now 50 unused
    assert db.query(InviteCode).count() == 49 + 4 + 4 + 1


@pytest.mark.parametrize("raw, stored", [("  Friend one \n", "Friend one"), ("   ", None), ("", None), (None, None), ("x" * 200, "x" * 200)])
def test_note_is_trimmed_blank_becomes_null_200_ok(admin, raw, stored):
    r = create(admin, note=raw)
    assert r.status_code == 201 and r.json()["note"] == stored


def test_note_over_200_code_points_is_422(admin, db):
    assert create(admin, note="x" * 201).status_code == 422
    assert create(admin, note="\U0001f600" * 201).status_code == 422  # code points, not bytes
    assert db.query(InviteCode).count() == 0


def test_note_with_nul_is_422_on_the_note_field_and_creates_nothing(admin, db):
    r = create(admin, note="a\x00b")
    assert r.status_code == 422 and r.json()["detail"][0]["loc"][-1] == "note"
    assert db.query(InviteCode).count() == 0


def test_note_with_tab_newline_and_emoji_is_still_201(admin):
    note = "a\tb\nc \U0001f600"
    r = create(admin, note=note)
    assert r.status_code == 201 and r.json()["note"] == note


@pytest.mark.parametrize("days", [0, 1, 15, 31, "abc", None, 7.5])
def test_expires_in_days_outside_7_14_30_is_422(admin, db, days):
    assert create(admin, expires_in_days=days).status_code == 422
    assert db.query(InviteCode).count() == 0


@pytest.mark.parametrize("days", [7, 14, 30])
def test_expires_in_days_sets_expires_at(admin, days):
    r = create(admin, expires_in_days=days)
    assert r.status_code == 201
    expires = datetime.fromisoformat(r.json()["expires_at"])
    assert abs(expires - (datetime.now(timezone.utc) + timedelta(days=days))) < timedelta(minutes=1)


def test_unknown_extra_field_is_422(admin, db):
    assert create(admin, is_admin=True).status_code == 422
    assert db.query(InviteCode).count() == 0


def test_missing_password_is_422_not_500(admin):
    assert admin.post(URL, json={"expires_in_days": 7}).status_code == 422


def test_password_over_1024_chars_is_422(admin, db):
    assert create(admin, password="x" * 1025).status_code == 422
    assert db.query(InviteCode).count() == 0


def test_a_data_error_on_insert_propagates_and_is_a_500_not_the_limiters_503(admin, db, monkeypatch):
    secret = "TLN-TEST-AAAA-BBBB"

    def boom(*a, **k):
        raise DataError("INSERT INTO invite_codes", {"code": secret}, Exception("bad data"))

    monkeypatch.setattr(invites, "create", boom)
    with pytest.raises(DataError):
        create(admin)
    api = TestClient(app, raise_server_exceptions=False)  # a 500 as a response, not a re-raise
    api.cookies.update(admin.cookies)
    r = api.post(URL, json={"expires_in_days": 14, "password": USER_PASSWORD})
    assert r.status_code == 500 and secret not in r.text


def test_a_db_error_in_the_lock_or_count_is_503_and_creates_nothing(admin, db, monkeypatch):
    """Pins the lock and count inside fail_closed: outside it, the error would be a 500."""
    before = db.query(InviteCode).count()

    def boom(*a, **k):
        raise OperationalError("SELECT pg_advisory_xact_lock", {}, Exception("db down"))

    monkeypatch.setattr(admin_invites, "text", boom)  # the route's advisory-lock statement
    api = TestClient(app, raise_server_exceptions=False)
    api.cookies.update(admin.cookies)
    r = api.post(URL, json={"expires_in_days": 14, "password": USER_PASSWORD})
    assert r.status_code == 503
    assert db.query(InviteCode).count() == before


# --- real threads ---

def test_two_concurrent_creates_at_49_unused_give_one_201_and_one_409(monkeypatch):
    run = uuid.uuid4().hex[:8]
    email = f"admin-{run}@example.ph"
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins(email))
    uid = None
    try:
        setup = SessionLocal()
        try:
            u = User(email=email, password_hash=hash_password(USER_PASSWORD), account_name="Admin")
            setup.add(u)
            setup.commit()
            uid = u.id
            now = datetime.now(timezone.utc)
            for t in ("cap-a", "cap-b"):
                setup.add(SessionModel(token_hash=hash_session_token(t), user_id=uid, created_at=now, expires_at=now + timedelta(days=1)))
            for _ in range(49):
                _, code_hash = invites.generate()
                setup.add(InviteCode(code_hash=code_hash, note=run, created_at=now, expires_at=now + timedelta(days=1)))
            setup.commit()
            assert setup.query(InviteCode).filter(InviteCode.used_at.is_(None)).count() == 49
        finally:
            setup.close()

        barrier = threading.Barrier(2)
        out, errors = [], []

        def go(token):
            try:
                with TestClient(app) as c:
                    c.cookies.set("session_token", token)
                    barrier.wait(timeout=10)
                    out.append(create(c, note=run).status_code)
            except Exception as e:  # noqa: BLE001 - a thread would swallow it
                errors.append(e)

        join_all([spawn(go, t) for t in ("cap-a", "cap-b")])
        assert not errors, errors
        assert sorted(out) == [201, 409], out
        check = SessionLocal()
        try:
            assert check.query(InviteCode).filter(InviteCode.used_at.is_(None)).count() == 50
        finally:
            check.close()
    finally:
        purge(
            ("DELETE FROM invite_codes WHERE note = :n", {"n": run}),
            ("DELETE FROM users WHERE id = :i", {"i": uid}),
            (
                "DELETE FROM rate_limit_events WHERE key IN (:a, :b)",
                {"a": "admin-invite:ip:unknown", "b": f"admin-invite:user:{uid}"},
            ),
        )
