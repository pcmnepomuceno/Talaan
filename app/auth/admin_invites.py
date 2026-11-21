"""Admin-only invite management over HTTP (DECISIONS.md, 2026-11-21). Every route needs
require_admin. Shares status/revoke with the CLI through app.auth.invites."""

from fastapi import APIRouter, Depends, HTTPException, Response
from sqlalchemy.orm import Session

from app.auth import invites
from app.auth.dependencies import require_admin
from app.auth.models import InviteCode
from app.auth.schemas import InviteItem, InviteList
from app.database import get_db
from app.users.models import User

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
