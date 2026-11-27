"""Invite request races on real connections: committed rows, cleaned up in `purge`.
Secrets are wrapped and checks on them reduced to booleans, as in test_invite_requests.py."""

import hashlib
import uuid
from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text

from app import config
from app.auth import invite_requests, invites
from app.auth.models import InviteCode, InviteRequest
from app.auth.models import Session as SessionModel
from app.auth.security import hash_password, hash_session_token
from app.database import SessionLocal
from app.main import app
from app.users.models import User
from tests.auth.test_invite_requests import (
    ADMIN,
    STATUS,
    Secret,
    make_request,
    state_of,
)
from tests.concurrency import join_all, purge, spawn, wait_for_lock_waiter
from tests.conftest import USER_PASSWORD

LOCK_ROW = text("SELECT id FROM invite_requests WHERE id = :id FOR UPDATE")


@pytest.fixture
def committed(monkeypatch):
    """A committed admin with a session, and cleanup of everything these tests commit."""
    for name in ("ADMIN_INVITE_IP_LIMIT", "ADMIN_INVITE_USER_LIMIT", "INVITE_REQUEST_STATUS_IP_LIMIT"):
        monkeypatch.setattr(config, name, 10_000)
    email = f"admin-{uuid.uuid4().hex[:8]}@example.com"
    monkeypatch.setattr(config, "ADMIN_EMAILS", frozenset({email}))
    token = uuid.uuid4().hex
    db = SessionLocal()
    now = datetime.now(timezone.utc)
    user = User(email=email, password_hash=hash_password(USER_PASSWORD), account_name="A")
    db.add(user)
    db.commit()
    user_id = user.id
    db.add(SessionModel(token_hash=hash_session_token(token), user_id=user_id, created_at=now,
                        expires_at=now + timedelta(days=1)))
    db.commit()
    db.close()
    yield token
    purge(
        ("DELETE FROM invite_requests", {}),
        ("DELETE FROM invite_codes", {}),
        ("DELETE FROM users WHERE id = :id", {"id": user_id}),
        (("DELETE FROM rate_limit_events WHERE key IN ('admin-invite:ip:unknown', "
          "'invite-request-status:ip:unknown', :k)"), {"k": f"admin-invite:user:{user_id}"}),
    )


def committed_request(status="pending") -> tuple[int, Secret, Secret | None]:
    db = SessionLocal()
    try:
        row, token, code = make_request(db, status)
        return row.id, token, code
    finally:
        db.close()


def totals() -> tuple[list, int]:
    """([(status, has an invite)], number of invites)."""
    db = SessionLocal()
    try:
        rows = [(r.status.value, r.invite_id is not None) for r in db.query(InviteRequest)]
        return rows, db.query(InviteCode).count()
    finally:
        db.close()


def send(results, errors, name, admin_token, method, url, body=None):
    try:
        with TestClient(app) as c:
            if admin_token:
                c.cookies.set("session_token", admin_token)
            results[name] = c.request(method, url, json=body)
    except Exception as e:  # noqa: BLE001 - a thread would swallow it; asserted by the caller
        errors.append(type(e).__name__)  # the name only: a message could carry parameters


def reveal(db, token):
    return db.execute(
        text(invite_requests.REVEAL),
        {"h": hashlib.sha256(token.encode()).hexdigest(), "now": datetime.now(timezone.utc)},
    ).first()


def test_reveal_on_two_connections_the_second_waits_and_gets_nothing(committed):
    _, token, code = committed_request("approved")
    first, second = SessionLocal(), SessionLocal()
    got, errors = [], []

    def other():
        try:
            got.append(reveal(second, token) is None)
            second.commit()
        except Exception as e:  # noqa: BLE001
            errors.append(type(e).__name__)

    try:
        row = reveal(first, token)
        got_the_code = row is not None and row.code_plain == code
        assert got_the_code
        t = spawn(other)
        wait_for_lock_waiter()
        assert t.is_alive()
        first.commit()
        join_all([t], timeout=10)
        assert not errors, errors
        assert got == [True]
    finally:
        first.rollback()
        first.close()
        second.rollback()
        second.close()


def test_two_concurrent_status_calls_give_one_code_and_one_shown(committed):
    request_id, token, code = committed_request("approved")
    holder = SessionLocal()
    results, errors = {}, []
    try:
        holder.execute(LOCK_ROW, {"id": request_id})
        body = {"token": str(token)}
        threads = [spawn(send, results, errors, n, None, "POST", STATUS, body) for n in ("a", "b")]
        wait_for_lock_waiter()
        holder.rollback()
        join_all(threads, timeout=15)
        assert not errors, errors
        states = sorted(state_of(r) for r in results.values())
        assert states == [(200, "approved", True), (200, "shown", False)]
        right_code = [r.json().get("code") == code for r in results.values() if "code" in r.json()]
        assert right_code == [True]
    finally:
        holder.rollback()
        holder.close()


def test_status_during_an_approve_never_says_expired(committed):
    """The reveal waits on approve's row lock, but its snapshot cannot see the invite approve
    inserted, so it matches nothing; the next read then sees an approved row with a code."""
    request_id, token, _ = committed_request("pending")
    holder = SessionLocal()
    results, errors = {}, []
    try:
        holder.execute(LOCK_ROW, {"id": request_id})
        invite, display = invites.create(holder, f"Request #{request_id}", timedelta(days=14), commit=False)
        holder.execute(
            text("UPDATE invite_requests SET status = 'approved', invite_id = :i, code_plain = :c WHERE id = :id"),
            {"i": invite.id, "c": display, "id": request_id},
        )
        t = spawn(send, results, errors, "status", None, "POST", STATUS, {"token": str(token)})
        wait_for_lock_waiter()
        holder.commit()
        join_all([t], timeout=15)
        assert not errors, errors
        assert state_of(results["status"]) == (200, "pending", False)
    finally:
        holder.rollback()
        holder.close()


def test_two_concurrent_approves_make_one_invite(committed):
    request_id, _, _ = committed_request()
    holder = SessionLocal()
    results, errors = {}, []
    try:
        holder.execute(LOCK_ROW, {"id": request_id})
        url = f"{ADMIN}/{request_id}/approve"
        threads = [
            spawn(send, results, errors, n, committed, "POST", url, {"password": USER_PASSWORD})
            for n in ("a", "b")
        ]
        wait_for_lock_waiter()
        holder.rollback()
        join_all(threads, timeout=30)
        assert not errors, errors
        assert sorted(r.status_code for r in results.values()) == [201, 409]
        assert totals() == ([("approved", True)], 1)
    finally:
        holder.rollback()
        holder.close()


@pytest.mark.parametrize("first", ["approve", "delete"])
def test_approve_against_delete_leaves_no_orphan(committed, first):
    request_id, _, _ = committed_request()
    holder = SessionLocal()
    results, errors = {}, []
    calls = {
        "approve": ("POST", f"{ADMIN}/{request_id}/approve", {"password": USER_PASSWORD}),
        "delete": ("DELETE", f"{ADMIN}/{request_id}"),
    }
    second = "delete" if first == "approve" else "approve"
    try:
        holder.execute(LOCK_ROW, {"id": request_id})
        a = spawn(send, results, errors, first, committed, *calls[first])
        wait_for_lock_waiter()  # `first` is queued on the row before `second` starts
        b = spawn(send, results, errors, second, committed, *calls[second])
        b.join(1.0)
        holder.rollback()
        join_all([a, b], timeout=30)
        assert not errors, errors
        assert results["delete"].status_code == 204
        approved = results["approve"].status_code
        rows, invite_count = totals()
        assert rows == []
        assert (approved, invite_count) in ((201, 1), (404, 0))
    finally:
        holder.rollback()
        holder.close()
