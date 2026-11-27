"""Admin-only invite management over HTTP (DECISIONS.md, 2026-11-21). Every route needs
require_admin. Shares status/revoke with the CLI through app.auth.invites."""

from datetime import timedelta

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import config
from app.auth import invites, rate_limit
from app.auth.dependencies import require_admin
from app.auth.models import InviteCode
from app.auth.schemas import InviteCreate, InviteCreated, InviteItem, InviteList
from app.auth.security import verify_password
from app.database import get_db
from app.users.models import User

# Fixed advisory-lock id that serializes the cap check and the insert across all admin creates.
CAP_LOCK_ID = rate_limit.lock_id("admin-invite:cap")

router = APIRouter(prefix="/admin/invites", tags=["admin"], dependencies=[Depends(require_admin)])


@router.get("", response_model=InviteList)
def list_invites(db: Session = Depends(get_db)) -> InviteList:
    """Every invite, newest first. Only the used-by account name is joined in: no code, hash or email."""
    # ponytail: unpaginated (the one exception to "every list is paginated"). Only unused invites
    # are capped (50); used and expired rows are not, but at friend-trial scale that is a few dozen.
    # Add limit/offset like GET /applications if the list ever gets long.
    rows = (
        db.query(InviteCode, User.account_name)
        .outerjoin(User, User.id == InviteCode.used_by_user_id)
        .order_by(InviteCode.id.desc())
        .all()
    )
    return InviteList(
        items=[
            InviteItem(
                id=i.id,
                status=invites.status(i),
                note=i.note,
                created_at=i.created_at,
                expires_at=i.expires_at,
                used_at=i.used_at,
                used_by_account_name=name,
            )
            for i, name in rows
        ]
    )


@router.delete("/{invite_id}", status_code=204)
def revoke_invite(invite_id: int, db: Session = Depends(get_db)) -> Response:
    """Delete an unused invite. Used ones stay (409): they are the record of who joined."""
    result = invites.revoke(db, invite_id)
    if result == "used":
        raise HTTPException(status_code=409, detail="This invite has been used and cannot be revoked.")
    if result == "missing":
        raise HTTPException(status_code=404, detail="Invite not found.")
    return Response(status_code=204)


def check_cap(db: Session) -> None:
    """409 if the unused, unexpired invites are at the cap. Shared by invite create and request
    approve. The caller must insert and commit in the same transaction."""
    # One transaction: the lock makes count-then-insert atomic, so two creates at 49 cannot both
    # pass. The commit (or the rollback below) releases it. Only the lock and the count are the
    # limiter's work (fail_closed: DB error -> 503); the insert and commit sit outside, so a real
    # DataError/IntegrityError is a logged 500, not a misleading 503. No commit in between, so
    # the lock is still held through the insert.
    with rate_limit.fail_closed(db):
        db.execute(text("SELECT pg_advisory_xact_lock(:id)"), {"id": CAP_LOCK_ID})
        open_count = (
            db.query(InviteCode)
            .filter(InviteCode.used_at.is_(None), InviteCode.expires_at > invites.utcnow())
            .count()
        )
    if open_count >= invites.MAX_OPEN_INVITES:
        db.rollback()
        raise HTTPException(
            status_code=409,
            detail=f"There are already {invites.MAX_OPEN_INVITES} unused invites. "
            "Revoke one or wait for one to expire.",
        )


@router.post("", status_code=201, response_model=InviteCreated)
def create_invite(
    body: InviteCreate,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> InviteCreated:
    """Create one invite. The plaintext code is in this response only: never log it."""
    # Plain values now: enforce() commits, which expires `admin`.
    user_id, password_hash = admin.id, admin.password_hash
    # Limits first, committed before bcrypt (as in account delete). Every attempt counts.
    rate_limit.enforce(
        db,
        ("admin-invite:ip:" + rate_limit.client_ip(request),
         config.ADMIN_INVITE_IP_LIMIT, config.ADMIN_INVITE_IP_WINDOW_SECONDS),
        (f"admin-invite:user:{user_id}",
         config.ADMIN_INVITE_USER_LIMIT, config.ADMIN_INVITE_USER_WINDOW_SECONDS),
    )
    # 403, not 401: the frontend treats 401 as "session expired" and would log the user out.
    if not verify_password(body.password, password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password.")

    check_cap(db)
    invite, display = invites.create(db, body.note, timedelta(days=body.expires_in_days), commit=False)
    result = InviteCreated(id=invite.id, code=display, note=invite.note, expires_at=invite.expires_at)
    db.commit()
    return result
