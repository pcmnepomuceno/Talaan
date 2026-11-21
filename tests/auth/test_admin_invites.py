from datetime import timedelta

import pytest

from app import config
from app.auth.models import InviteCode
from app.users.models import User
from tests.conftest import USER_EMAIL, as_user, create_invite

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


def test_non_admin_gets_404_on_list_and_revoke(client, db, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", parse_admins("someone-else@example.ph"))
    make_session("tok")
    as_user(client, "tok")
    r = client.get(URL)
    assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
    assert client.delete(f"{URL}/1").status_code == 404


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


def test_revoke_missing_is_404(admin):
    r = admin.delete(f"{URL}/999999")
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
