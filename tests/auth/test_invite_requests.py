"""Public invite requests and their admin side (docs/AUTH.md).

No test may print a status token or an invite code: both are wrapped in Secret (pytest tracebacks
show argument reprs), and checks on them are reduced to booleans before they are asserted.
"""

import hashlib
import json
import logging
import re
import secrets
from datetime import datetime, timedelta, timezone

import pytest
from sqlalchemy import text

from app import config
from app.auth import invite_requests, invites, password_resets
from app.auth.models import (
    InviteCode,
    InviteRequest,
    InviteRequestStatus,
    RateLimitEvent,
)
from tests.conftest import USER_EMAIL, USER_PASSWORD, as_user, create_invite

PUBLIC = "/api/v1/invite-requests"
STATUS = "/api/v1/invite-requests/status"
ADMIN = "/api/v1/admin/invite-requests"
CLOSED = {"detail": "Requests are closed right now."}
INVALID = {"detail": "Invalid or expired request link."}
DECIDED = {"detail": "This request has already been decided."}
NOW = datetime(2026, 11, 27, 12, 0, tzinfo=timezone.utc)


class Secret(str):
    def __repr__(self):
        return "<secret>"


def make_request(db, status="pending", code_valid_for=timedelta(days=14), used=False, created_at=None,
                 token=None, contact="ana@example.ph", note="From the meetup", revealed=False, code_cleared=False):
    """A request row straight in the DB. An approved one gets a real invite and its plaintext code,
    unless `revealed`. Returns (row, status token, code or None)."""
    token = Secret(token or secrets.token_urlsafe(32))
    now = datetime.now(timezone.utc)
    row = InviteRequest(
        contact=contact, note=note, status=InviteRequestStatus(status),
        status_token_hash=hashlib.sha256(token.encode()).hexdigest(), created_at=created_at or now,
    )
    code = None
    if status == "approved":
        display, code_hash = invites.generate()
        code = Secret(display)
        invite = InviteCode(code_hash=code_hash, created_at=now, expires_at=now + code_valid_for,
                            used_at=now if used else None)
        db.add(invite)
        db.flush()
        row.invite_id, row.decided_at = invite.id, now
        row.code_plain = None if revealed or code_cleared else display
        row.revealed_at = now if revealed else None
    elif status == "rejected":
        row.decided_at = now
    db.add(row)
    db.commit()
    return row, token, code


# --- public: create ---

def json_body(value) -> Secret:
    """JSON with non-ASCII escaped (a lone surrogate cannot be sent raw)."""
    return Secret(json.dumps(value))


def post_raw(client, url, body: Secret):
    """Takes the serialized body, wrapped: a traceback would print a dict holding a token or code."""
    return client.post(url, content=body, headers={"content-type": "application/json"})


def ask(client, contact="ana@example.ph", note="From the meetup", website=""):
    return post_raw(client, PUBLIC, json_body({"contact": contact, "note": note, "website": website}))


def token_from(r) -> Secret:
    assert r.status_code == 201
    keys = sorted(r.json())
    assert keys == ["token"]
    return Secret(r.json()["token"])


def check_status(client, token):
    return post_raw(client, STATUS, json_body({"token": str(token)}))


def state_of(r):
    """(HTTP status, state, has a code): safe to compare in an assert."""
    body = r.json()
    return r.status_code, body.get("state"), "code" in body


def count(db, model=InviteRequest):
    return db.query(model).count()


def test_create_stores_a_pending_row_with_only_the_token_hash(client, db):
    r = ask(client, contact="  ana@example.ph  ", note="  hi  ")
    assert r.headers["cache-control"] == "no-store"
    token = token_from(r)
    row = db.query(InviteRequest).one()
    assert (row.contact, row.note, row.status) == ("ana@example.ph", "hi", InviteRequestStatus.pending)
    assert (row.decided_at, row.invite_id, row.code_plain, row.revealed_at) == (None, None, None, None)
    hashed = row.status_token_hash == hashlib.sha256(token.encode()).hexdigest()
    assert hashed
    stored = db.execute(text("SELECT * FROM invite_requests")).one()
    leaked = any(token in str(value) for value in stored)
    assert not leaked


def test_honeypot_stores_nothing_and_looks_like_a_real_answer(client, db):
    real = token_from(ask(client))
    fake = token_from(ask(client, website="http://spam.example"))
    assert count(db) == 1
    same_shape = len(fake) == len(real) == 43 and re.fullmatch(r"[A-Za-z0-9_-]+", fake) is not None
    assert same_shape
    a, b = check_status(client, fake), check_status(client, Secret(secrets.token_urlsafe(32)))
    identical = (a.status_code, a.content) == (b.status_code, b.content)
    assert identical
    assert a.status_code == 400 and a.json() == INVALID


@pytest.mark.parametrize("website", [" ", "x" * 10_000, "a\x00b"])
def test_website_is_never_validated(client, db, website):
    assert ask(client, website=website).status_code == 201
    assert count(db) == (1 if not website.strip() else 0)


@pytest.mark.parametrize("field,value", [
    ("contact", "nul\x00here"), ("note", "nul\x00here"),
    ("contact", "lone\ud800here"), ("note", "lone\ud800here"),
    ("contact", "   "), ("note", " \n "),
    ("contact", "c" * 201), ("note", "n" * 1001),
    ("contact", 12345678),
])
def test_bad_fields_are_422_and_never_echoed(client, db, field, value):
    body = {"contact": "ana-secret@example.ph", "note": "private note", field: value}
    r = post_raw(client, PUBLIC, json_body(body))
    assert r.status_code == 422
    assert r.json()["detail"][0]["loc"][-1] == field
    assert all(e["input"] is None for e in r.json()["detail"])
    assert "ana-secret" not in r.text and "private note" not in r.text
    assert not isinstance(value, str) or not value.strip() or value[:12] not in r.text
    assert count(db) == 0


def test_extra_field_is_422(client, db):
    r = client.post(PUBLIC, json={"contact": "ana-secret", "note": "n", "email": "x@y.z"})
    assert r.status_code == 422 and "ana-secret" not in r.text and "x@y.z" not in r.text
    assert count(db) == 0


@pytest.mark.parametrize("contact,note", [
    ("\U0001f600" * 200, "\U0001f600" * 1000),  # the caps count code points, not bytes
    ("  " + "c" * 200 + "  ", "n" * 1000),  # stripped before the cap
])
def test_emoji_and_long_text_are_accepted_at_the_cap(client, db, contact, note):
    token_from(ask(client, contact=contact, note=note))
    row = db.query(InviteRequest).one()
    assert (row.contact, row.note) == (contact.strip(), note)


def test_rate_limit_is_committed_before_the_insert(client, db, monkeypatch):
    def boom():
        raise RuntimeError("insert would fail")

    monkeypatch.setattr(config, "INVITE_REQUEST_IP_LIMIT", 1)
    monkeypatch.setattr(password_resets, "generate", boom)
    with pytest.raises(RuntimeError):
        ask(client)
    db.rollback()
    assert count(db, RateLimitEvent) == 1
    r = ask(client)  # over the limit: 429 before the failing work, and not recorded
    assert r.status_code == 429 and int(r.headers["retry-after"]) >= 1
    assert count(db, RateLimitEvent) == 1 and count(db) == 0


def test_pending_cap_closes_requests_and_counts_only_pending(client, db, monkeypatch):
    monkeypatch.setattr(config, "INVITE_REQUEST_PENDING_CAP", 2)
    make_request(db, "rejected")
    make_request(db, "approved")
    make_request(db, "pending")
    assert ask(client).status_code == 201
    for website in ("", "bot"):  # a bot sees the same answer as a person
        r = ask(client, website=website)
        assert r.status_code == 409 and r.json() == CLOSED
    assert count(db) == 4


# --- public: status ---

def test_pending_and_rejected(client, db):
    row, pending, _ = make_request(db, "pending")
    _, rejected, _ = make_request(db, "rejected")
    r = check_status(client, pending)
    assert (r.status_code, r.json()) == (200, {"state": "pending"})
    assert r.headers["cache-control"] == "no-store"
    r = check_status(client, rejected)
    assert (r.status_code, r.json()) == (200, {"state": "rejected"})
    db.refresh(row)
    assert row.revealed_at is None


def test_approved_code_is_returned_once(client, db):
    row, token, code = make_request(db, "approved")
    first = check_status(client, token)
    assert state_of(first) == (200, "approved", True)
    got_the_code = first.json()["code"] == code
    assert got_the_code
    db.refresh(row)
    cleared = row.code_plain is None
    assert cleared and row.revealed_at is not None
    assert state_of(check_status(client, token)) == (200, "shown", False)


@pytest.mark.parametrize("kwargs,state", [
    ({"code_valid_for": timedelta(seconds=-1)}, "expired"),
    ({"used": True}, "shown"),
    ({"revealed": True}, "shown"),
    ({"code_cleared": True}, "expired"),  # a live invite, but no code left and never revealed
])
def test_approved_without_a_code_to_show(client, db, kwargs, state):
    row, token, _ = make_request(db, "approved", **kwargs)
    code_before, revealed_before = row.code_plain, row.revealed_at
    assert state_of(check_status(client, token)) == (200, state, False)
    db.refresh(row)
    unchanged = (row.code_plain, row.revealed_at) == (code_before, revealed_before)
    assert unchanged


@pytest.mark.parametrize("revealed,state", [(False, "expired"), (True, "shown")])
def test_revoked_invite(client, db, revealed, state):
    row, token, _ = make_request(db, "approved", revealed=revealed)
    assert invites.revoke(db, row.invite_id) == "revoked"
    code_before, revealed_before = row.code_plain, row.revealed_at
    assert state_of(check_status(client, token)) == (200, state, False)
    db.refresh(row)
    unchanged = (row.code_plain, row.revealed_at) == (code_before, revealed_before)
    assert unchanged


def test_every_bad_token_gets_the_identical_response(client, db, monkeypatch):
    monkeypatch.setattr(config, "INVITE_REQUEST_STATUS_IP_LIMIT", 100)
    row, deleted, _ = make_request(db)
    db.delete(row)
    db.commit()
    bad = {
        "deleted": deleted, "unknown": secrets.token_urlsafe(32), "fake": "not-a-token", "empty": "",
        "65 characters": "a" * 65, "huge": "a" * 10_000, "non-ascii": "t\u00f6ken",
        "lone surrogate": "\ud800", "nul": "a\x00b",
    }
    seen = set()
    for name, token in bad.items():
        r = check_status(client, token)
        assert (r.status_code, r.json()) == (400, INVALID), name
        assert r.headers["cache-control"] == "no-store", name
        seen.add(r.content)
    assert len(seen) == 1


def test_status_takes_no_query_string_token_and_422_never_echoes_it(client, db):
    row, token, _ = make_request(db, "approved")
    for r in (client.post(STATUS, params={"token": str(token)}),
              client.post(STATUS, params={"token": str(token)}, json={}),
              post_raw(client, STATUS, json_body({"token": [str(token)]})),
              post_raw(client, STATUS, json_body(str(token)))):
        assert r.status_code == 422
        echoed = token in r.text
        assert not echoed
    db.refresh(row)
    still_there = row.code_plain is not None
    assert still_there


def test_status_rate_limit_comes_first(client, db, monkeypatch):
    monkeypatch.setattr(config, "INVITE_REQUEST_STATUS_IP_LIMIT", 1)
    row, token, _ = make_request(db, "approved")
    assert check_status(client, "nope").status_code == 400
    r = check_status(client, token)
    assert r.status_code == 429
    db.refresh(row)
    assert row.revealed_at is None


def test_cross_site_writes_are_blocked(client, db):
    for url in (PUBLIC, STATUS):
        r = client.post(url, json={}, headers={"sec-fetch-site": "cross-site"})
        assert r.status_code == 403


# --- admin ---

@pytest.fixture
def admin(client, db, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    make_session("tok")
    as_user(client, "tok")
    return client


def approve(client, request_id, password=USER_PASSWORD):
    return client.post(f"{ADMIN}/{request_id}/approve", json={"password": password})


def admin_calls(client, request_id):
    return (
        client.get(ADMIN),
        approve(client, request_id),
        client.post(f"{ADMIN}/{request_id}/reject"),
        client.delete(f"{ADMIN}/{request_id}"),
    )


def test_anonymous_gets_401_on_every_admin_route(client, db, user, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({USER_EMAIL}))
    row, _, _ = make_request(db)
    assert [r.status_code for r in admin_calls(client, row.id)] == [401] * 4
    assert count(db) == 1


def test_non_admin_gets_404_on_every_admin_route(client, db, user, make_session, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({"someone-else@example.ph"}))
    make_session("tok")
    as_user(client, "tok")
    row, _, _ = make_request(db)
    for r in admin_calls(client, row.id):
        assert r.status_code == 404 and r.json() == {"detail": "Not Found"}
        assert r.headers["cache-control"] == "no-store"
    db.refresh(row)
    assert row.status == InviteRequestStatus.pending
    assert count(db, RateLimitEvent) == 0 and count(db, InviteCode) == 0


def test_list_is_newest_first_without_code_or_hash(admin, db):
    older, _, _ = make_request(db, "approved", contact="older")
    newer, _, _ = make_request(db, "pending", contact="newer")
    r = admin.get(ADMIN)
    assert r.status_code == 200
    items = r.json()["items"]
    assert [i["id"] for i in items] == [newer.id, older.id]
    assert all(
        set(i) == {"id", "contact", "note", "status", "created_at", "decided_at", "revealed_at"} for i in items
    )
    assert [i["status"] for i in items] == ["pending", "approved"]


def test_approve_links_a_working_invite_and_returns_the_code_once(admin, db, monkeypatch):
    monkeypatch.setattr(invite_requests, "utcnow", lambda: NOW)
    row, token, _ = make_request(db)
    r = approve(admin, row.id)
    assert r.status_code == 201
    keys = sorted(r.json())
    assert keys == ["code", "expires_at", "id"]
    code = Secret(r.json()["code"])
    invite = db.query(InviteCode).one()
    invite_id, expires_at = r.json()["id"], r.json()["expires_at"]
    assert invite_id == invite.id and datetime.fromisoformat(expires_at) == invite.expires_at
    assert invite.note == f"Request #{row.id}"  # not the contact: it must not outlive the request
    assert timedelta(days=14) - timedelta(minutes=1) < invite.expires_at - invite.created_at <= timedelta(days=14)
    db.refresh(row)
    assert (row.status, row.invite_id, row.decided_at) == (InviteRequestStatus.approved, invite.id, NOW)
    kept = row.code_plain == code
    assert kept
    shown = check_status(admin, token).json().get("code") == code
    assert shown
    signup = post_raw(admin, "/api/v1/signup", json_body({
        "email": "new@example.com", "password": "Str0ng!pass", "account_name": "New", "invite_code": str(code),
    }))
    assert signup.status_code == 200


def test_approve_twice_is_409(admin, db):
    row, _, _ = make_request(db)
    assert approve(admin, row.id).status_code == 201
    r = approve(admin, row.id)
    assert r.status_code == 409 and r.json() == DECIDED
    assert count(db, InviteCode) == 1


def test_approve_a_missing_request_is_404(admin, db):
    r = approve(admin, 999999)
    assert r.status_code == 404 and r.json() == {"detail": "Request not found."}
    assert count(db, InviteCode) == 0


def test_approve_wrong_password_is_403_before_the_lookup(admin, db):
    row, _, _ = make_request(db)
    for request_id in (row.id, 999999):
        r = approve(admin, request_id, password="Wr0ng!pass")
        assert r.status_code == 403 and r.json() == {"detail": "Incorrect password."}
    assert count(db, InviteCode) == 0


def test_approve_shares_the_invite_budget_and_limits_before_the_password(admin, db, monkeypatch):
    monkeypatch.setattr(config, "ADMIN_INVITE_USER_LIMIT", 1)
    row, _, _ = make_request(db)
    r = admin.post("/api/v1/admin/invites", json={"expires_in_days": 7, "password": "Wr0ng!pass"})
    assert r.status_code == 403  # one slot of the shared budget used
    calls = []
    monkeypatch.setattr(invite_requests, "verify_password", lambda *a: calls.append(1))
    assert approve(admin, row.id).status_code == 429
    assert not calls and count(db, InviteCode) == 0


def test_approve_shares_the_unused_invite_cap(admin, db):
    for _ in range(invites.MAX_OPEN_INVITES):
        create_invite(db)
    row, _, _ = make_request(db)
    r = approve(admin, row.id)
    direct = admin.post("/api/v1/admin/invites", json={"expires_in_days": 7, "password": USER_PASSWORD})
    assert r.status_code == 409 and r.json() == direct.json()
    db.refresh(row)
    assert row.status == InviteRequestStatus.pending
    assert count(db, InviteCode) == invites.MAX_OPEN_INVITES


def test_reject_then_delete(admin, db):
    row, _, _ = make_request(db)
    request_id = row.id
    assert admin.post(f"{ADMIN}/{request_id}/reject").status_code == 204
    db.refresh(row)
    assert row.status == InviteRequestStatus.rejected and row.decided_at is not None
    r = admin.post(f"{ADMIN}/{request_id}/reject")
    assert r.status_code == 409 and r.json() == DECIDED
    assert approve(admin, request_id).status_code == 409
    assert admin.delete(f"{ADMIN}/{request_id}").status_code == 204
    assert count(db) == 0
    assert admin.delete(f"{ADMIN}/{request_id}").status_code == 404
    assert admin.post(f"{ADMIN}/{request_id}/reject").status_code == 404


def test_deleting_an_approved_request_leaves_the_invite(admin, db):
    row, _, _ = make_request(db, "approved")
    assert admin.delete(f"{ADMIN}/{row.id}").status_code == 204
    assert count(db) == 0 and count(db, InviteCode) == 1


# --- logs ---

def test_nothing_logs_the_contact_note_token_or_code(admin, db, caplog):
    caplog.set_level(logging.DEBUG)
    contact, note = "private-contact@example.ph", "private-note-text"
    token = token_from(ask(admin, contact=contact, note=note))
    check_status(admin, token)
    request_id = admin.get(ADMIN).json()["items"][0]["id"]
    r = approve(admin, request_id)
    code = Secret(r.json()["code"])
    check_status(admin, token)
    check_status(admin, token)
    approve(admin, request_id)
    admin.post(f"{ADMIN}/{request_id}/reject")
    admin.delete(f"{ADMIN}/{request_id}")
    ask(admin, contact=contact, note="x" * 1001)
    check_status(admin, token)
    logged = any(value in caplog.text for value in (contact, note, token, code, USER_PASSWORD))
    assert not logged
