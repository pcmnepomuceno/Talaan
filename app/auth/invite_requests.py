"""Public invite requests and their admin side (docs/AUTH.md, DECISIONS.md 2026-11-27).

A requester gets a private status link (/request#<token>); only the SHA-256 of the token is stored.
On approve the invite code is kept in `code_plain` until the requester sees it, once. No email is
sent. Never log a status token or a code.

Lock order: approve, reveal and delete each lock the request row first (approve and reveal with
their own SELECT ... FOR UPDATE on that table alone, delete with its own DELETE). A lock written as a
statement of its own is taken whatever plan the database picks, so the order holds in every plan.
Approve then takes the invite cap advisory lock and inserts the invite in the same transaction. A
revoke (FK SET NULL) locks an invite row and then its request row; nothing locks an invite row while
it holds a request row, so the two orders cannot form a cycle.
"""

from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import config
from app.auth import admin_invites, invites, password_resets, rate_limit
from app.auth.dependencies import require_admin
from app.auth.models import InviteCode, InviteRequest, InviteRequestStatus
from app.auth.schemas import (
    InviteRequestApprove,
    InviteRequestApproved,
    InviteRequestCreate,
    InviteRequestCreated,
    InviteRequestItem,
    InviteRequestList,
    InviteRequestState,
    InviteRequestStatusQuery,
)
from app.auth.security import hash_session_token, verify_password
from app.database import get_db
from app.users.models import User

# Serializes the pending-cap count and the insert across all public creates.
CAP_LOCK_ID = rate_limit.lock_id("invite-request:cap")
INVITE_LIFETIME = timedelta(days=14)
# token_urlsafe(32) is 43 characters. Longer input is rejected before hashing.
MAX_INPUT_LEN = 64
DECIDED = "This request has already been decided."

router = APIRouter(prefix="/invite-requests", tags=["invite requests"])
admin_router = APIRouter(
    prefix="/admin/invite-requests", tags=["admin"], dependencies=[Depends(require_admin)]
)


def utcnow() -> datetime:
    """This module's clock. Tests patch it instead of sleeping."""
    return datetime.now(timezone.utc)


def invalid() -> HTTPException:
    """The one response for every bad status token: unknown, fake, deleted, malformed."""
    return HTTPException(status_code=400, detail="Invalid or expired request link.")


@router.post("", status_code=201, response_model=InviteRequestCreated)
def create_request(
    body: InviteRequestCreate, request: Request, db: Session = Depends(get_db)
) -> InviteRequestCreated:
    """Store a request and return its status token (this response only)."""
    rate_limit.enforce(
        db,
        ("invite-request:ip:" + rate_limit.client_ip(request),
         config.INVITE_REQUEST_IP_LIMIT, config.INVITE_REQUEST_IP_WINDOW_SECONDS),
    )
    # One transaction: the lock makes count-then-insert atomic.
    with rate_limit.fail_closed(db):
        db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": CAP_LOCK_ID})
        pending = db.query(InviteRequest).filter(InviteRequest.status == InviteRequestStatus.pending).count()
    if pending >= config.INVITE_REQUEST_PENDING_CAP:
        db.rollback()
        raise HTTPException(status_code=409, detail="Requests are closed right now.")
    token, token_hash = password_resets.generate()
    # Honeypot, after the cap so a bot sees the same answers as a person: a token, nothing stored.
    if body.website.strip():
        db.rollback()
        return InviteRequestCreated(token=token)
    db.add(InviteRequest(contact=body.contact, note=body.note, status=InviteRequestStatus.pending,
                         status_token_hash=token_hash, created_at=utcnow()))
    db.commit()
    return InviteRequestCreated(token=token)


@router.post("/status", response_model=InviteRequestState, response_model_exclude_none=True)
def request_status(
    body: InviteRequestStatusQuery, request: Request, db: Session = Depends(get_db)
) -> InviteRequestState:
    """The request's state. An approved request's code is in exactly one of these responses."""
    rate_limit.enforce(
        db,
        ("invite-request-status:ip:" + rate_limit.client_ip(request),
         config.INVITE_REQUEST_STATUS_IP_LIMIT, config.INVITE_REQUEST_STATUS_IP_WINDOW_SECONDS),
    )
    if len(body.token) > MAX_INPUT_LEN or not body.token.isascii():
        raise invalid()
    # One transaction. Lock the request row first, by itself: inside a join or a subquery the planner
    # may never run the lock. A caller that waited here reads the row as the other side committed it.
    row = (
        db.query(InviteRequest)
        .filter(InviteRequest.status_token_hash == hash_session_token(body.token))
        .with_for_update()
        .populate_existing()  # never a stale copy from the session's identity map
        .first()
    )
    if row is None:
        raise invalid()
    if row.status != InviteRequestStatus.approved:
        return InviteRequestState(state=row.status.value)
    # A second statement, not a join: its snapshot is taken after the wait, so it sees the invite an
    # approve has just committed. The invite row is read, not locked.
    invite = (
        db.query(InviteCode.used_at, InviteCode.expires_at).filter(InviteCode.id == row.invite_id).first()
    )
    if row.revealed_at is not None or (invite is not None and invite.used_at is not None):
        return InviteRequestState(state="shown")
    now = utcnow()
    code = row.code_plain
    if code is None or invite is None or invite.expires_at <= now:
        return InviteRequestState(state="expired")
    row.code_plain, row.revealed_at = None, now
    db.commit()
    return InviteRequestState(state="approved", code=code)


@admin_router.get("", response_model=InviteRequestList)
def list_requests(db: Session = Depends(get_db)) -> InviteRequestList:
    """Every request, newest first. No code and no token hash."""
    # ponytail: unpaginated. Pending rows are capped and purge keeps 30 days; add limit/offset
    # like GET /applications if the list ever gets long.
    rows = db.query(InviteRequest).order_by(InviteRequest.id.desc()).all()
    return InviteRequestList(
        items=[
            InviteRequestItem(
                id=r.id, contact=r.contact, note=r.note, status=r.status.value,
                created_at=r.created_at, decided_at=r.decided_at, revealed_at=r.revealed_at,
            )
            for r in rows
        ]
    )


def _missing_or_decided(db: Session, request_id: int) -> HTTPException:
    exists = db.query(InviteRequest.id).filter(InviteRequest.id == request_id).first() is not None
    if exists:
        return HTTPException(status_code=409, detail=DECIDED)
    return HTTPException(status_code=404, detail="Request not found.")


@admin_router.post("/{request_id}/approve", status_code=201, response_model=InviteRequestApproved)
def approve_request(
    request_id: int,
    body: InviteRequestApprove,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> InviteRequestApproved:
    """Create the invite for a pending request. The code in this response is the admin's one-time
    backup copy; the requester sees it once through the status link. Never log it."""
    # Plain values now: enforce() commits, which expires `admin`.
    admin_id, password_hash = admin.id, admin.password_hash
    # The invite-create budget, shared: approving is creating an invite.
    rate_limit.enforce(
        db,
        ("admin-invite:ip:" + rate_limit.client_ip(request),
         config.ADMIN_INVITE_IP_LIMIT, config.ADMIN_INVITE_IP_WINDOW_SECONDS),
        (f"admin-invite:user:{admin_id}",
         config.ADMIN_INVITE_USER_LIMIT, config.ADMIN_INVITE_USER_WINDOW_SECONDS),
    )
    # 403, not 401: the frontend treats 401 as "session expired" and would log the user out.
    if not verify_password(body.password, password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password.")

    row = db.query(InviteRequest).filter(InviteRequest.id == request_id).with_for_update().first()
    if row is None or row.status != InviteRequestStatus.pending:
        raise _missing_or_decided(db, request_id)
    admin_invites.check_cap(db)
    # The note names the request, not the contact, so the contact does not outlive the purge here.
    invite, display = invites.create(db, f"Request #{request_id}", INVITE_LIFETIME, commit=False)
    row.status = InviteRequestStatus.approved
    row.decided_at = utcnow()
    row.invite_id = invite.id
    row.code_plain = display
    result = InviteRequestApproved(id=invite.id, code=display, expires_at=invite.expires_at)
    db.commit()
    return result


@admin_router.post("/{request_id}/reject", status_code=204)
def reject_request(request_id: int, db: Session = Depends(get_db)) -> Response:
    """Reject a pending request. One UPDATE, so it cannot overwrite a concurrent approve."""
    rejected = db.execute(
        text(
            "UPDATE invite_requests SET status = 'rejected', decided_at = :now "
            "WHERE id = :id AND status = 'pending' RETURNING id"
        ),
        {"now": utcnow(), "id": request_id},
    ).first()
    if rejected is None:
        raise _missing_or_decided(db, request_id)
    db.commit()
    return Response(status_code=204)


@admin_router.delete("/{request_id}", status_code=204)
def delete_request(request_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete a request. It never touches the invite: revoke that under Invites."""
    deleted = db.execute(
        text("DELETE FROM invite_requests WHERE id = :id RETURNING id"), {"id": request_id}
    ).first()
    if deleted is None:
        raise HTTPException(status_code=404, detail="Request not found.")
    db.commit()
    return Response(status_code=204)
