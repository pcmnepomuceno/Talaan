"""Admin-generated password reset links (docs/AUTH.md).

An admin (or the CLI) creates a single-use, 24-hour token and passes the link on by hand. Only the
SHA-256 of the token is stored. Never log a token: it leaves the server once, in the create
response (or the one CLI print).

Lock order, shared with account delete: the user row first, then its token rows. A reset never
waits on a limiter row while it holds the user row (login holds a limiter row, then wants the
user row), so the login lockout is cleared after the commit, best effort.
"""

import logging
import secrets
from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.orm import Session

from app import config
from app.auth import rate_limit
from app.auth.dependencies import require_admin
from app.auth.models import PasswordResetToken, RateLimitEvent
from app.auth.models import Session as SessionModel
from app.auth.schemas import PasswordReset, PasswordResetCreate, PasswordResetCreated
from app.auth.security import hash_password, hash_session_token, verify_password
from app.database import get_db
from app.users.models import User

logger = logging.getLogger(__name__)

LIFETIME = timedelta(hours=24)
# token_urlsafe(32) is 43 characters. Longer input is rejected before hashing.
MAX_INPUT_LEN = 64
NO_ACCOUNT = "No account with that email."

admin_router = APIRouter(
    prefix="/admin/password-resets", tags=["admin"], dependencies=[Depends(require_admin)]
)
router = APIRouter(prefix="/auth", tags=["auth"])


def utcnow() -> datetime:
    """This module's clock. Tests patch it instead of sleeping."""
    return datetime.now(timezone.utc)


def generate() -> tuple[str, str]:
    """Return (token, hash). 256 random bits; the token exists only in the caller's memory."""
    token = secrets.token_urlsafe(32)
    return token, hash_session_token(token)


def invalid() -> HTTPException:
    """The one response for every bad token: unknown, expired, used, voided, malformed."""
    return HTTPException(status_code=400, detail="Invalid or expired reset link.")


def create(db: Session, user_id: int, created_by: int | None) -> tuple[str, datetime] | None:
    """Void the user's unused tokens and add a new one; return (token, expires_at), or None if the
    account is gone. Flushes only: the caller commits. The user row lock serializes concurrent
    creates, so exactly one unused token remains."""
    locked = db.execute(text("SELECT id FROM users WHERE id = :id FOR UPDATE"), {"id": user_id}).first()
    if locked is None:
        return None
    db.query(PasswordResetToken).filter(
        PasswordResetToken.user_id == user_id, PasswordResetToken.used_at.is_(None)
    ).delete(synchronize_session=False)
    token, token_hash = generate()
    now = utcnow()
    db.add(PasswordResetToken(user_id=user_id, token_hash=token_hash, created_at=now,
                              expires_at=now + LIFETIME, created_by=created_by))
    db.flush()
    return token, now + LIFETIME


def consume(db: Session, token_hash: str) -> tuple[int, int | None] | None:
    """Atomically mark the token used and return (user_id, created_by); None if it is missing,
    used or expired. Under a race one UPDATE wins and the other then matches nothing. The caller
    commits."""
    row = db.execute(
        text(
            "UPDATE password_reset_tokens SET used_at = :now "
            "WHERE token_hash = :h AND used_at IS NULL AND expires_at > :now "
            "RETURNING user_id, created_by"
        ),
        {"now": utcnow(), "h": token_hash},
    ).first()
    return None if row is None else (row.user_id, row.created_by)


@admin_router.post("", status_code=201, response_model=PasswordResetCreated)
def create_reset_link(
    body: PasswordResetCreate,
    request: Request,
    admin: User = Depends(require_admin),
    db: Session = Depends(get_db),
) -> PasswordResetCreated:
    """Create a reset link for a non-admin account. The token is in this response only."""
    # Plain values now: enforce() commits, which expires `admin`.
    admin_id, password_hash = admin.id, admin.password_hash
    rate_limit.enforce(
        db,
        ("admin-reset:ip:" + rate_limit.client_ip(request),
         config.ADMIN_RESET_IP_LIMIT, config.ADMIN_RESET_IP_WINDOW_SECONDS),
        (f"admin-reset:user:{admin_id}",
         config.ADMIN_RESET_USER_LIMIT, config.ADMIN_RESET_USER_WINDOW_SECONDS),
    )
    # 403, not 401: the frontend treats 401 as "session expired" and would log the user out.
    if not verify_password(body.admin_password, password_hash):
        raise HTTPException(status_code=403, detail="Incorrect password.")

    # After the password check, so the endpoint cannot be used to probe emails without it.
    target = db.query(User.id, User.email).filter(User.email == body.email).first()
    if target is None:
        raise HTTPException(status_code=404, detail=NO_ACCOUNT)
    if target.id == admin_id:
        raise HTTPException(status_code=400, detail="You can't reset your own password here.")
    if config.is_admin(target.email):
        raise HTTPException(status_code=400, detail="Admin accounts are reset with the CLI.")

    created = create(db, target.id, admin_id)
    if created is None:  # deleted since the lookup
        raise HTTPException(status_code=404, detail=NO_ACCOUNT)
    db.commit()
    return PasswordResetCreated(token=created[0], expires_at=created[1])


@router.post("/reset-password", status_code=204)
def reset_password(body: PasswordReset, request: Request, db: Session = Depends(get_db)) -> Response:
    """Set a new password with a reset token and end every session of that account."""
    rate_limit.enforce(
        db,
        ("reset-password:ip:" + rate_limit.client_ip(request),
         config.RESET_PASSWORD_IP_LIMIT, config.RESET_PASSWORD_IP_WINDOW_SECONDS),
    )
    # Not a schema constraint: a 422 would differ from the generic 400 every other bad token gets.
    if len(body.token) > MAX_INPUT_LEN or not body.token.isascii():
        raise invalid()
    token_hash = hash_session_token(body.token)
    password_hash = hash_password(body.new_password)  # slow: before any lock is taken

    # One transaction. The user row is locked before the token row (the order create and account
    # delete use), so the two cannot deadlock.
    db.execute(
        text(
            "SELECT id FROM users WHERE id = "
            "(SELECT user_id FROM password_reset_tokens WHERE token_hash = :h) FOR UPDATE"
        ),
        {"h": token_hash},
    )
    consumed = consume(db, token_hash)
    if consumed is None:
        db.rollback()
        raise invalid()
    user_id, created_by = consumed
    # The rules the link was made under, checked again now: an admin-made link only works while
    # its creator exists and is still an admin and the target is still not one. CLI links
    # (created_by NULL) work for any account. The link stays unused when refused.
    target_email = db.execute(text("SELECT email FROM users WHERE id = :id"), {"id": user_id}).scalar_one()
    if created_by is not None:
        creator_email = db.execute(text("SELECT email FROM users WHERE id = :id"), {"id": created_by}).scalar()
        if creator_email is None or not config.is_admin(creator_email) or config.is_admin(target_email):
            db.rollback()
            raise invalid()
    db.execute(text("UPDATE users SET password_hash = :p WHERE id = :id"), {"p": password_hash, "id": user_id})
    db.query(SessionModel).filter(SessionModel.user_id == user_id).delete(synchronize_session=False)
    db.commit()

    # A friend locked out by failed logins can log in right away. Separate transaction, no user row
    # lock held: a login in flight holds its limiter row while it waits for the user row. The
    # password is already changed, so a failure here is only logged (no email, no key).
    try:
        db.query(RateLimitEvent).filter(RateLimitEvent.key == rate_limit.email_key(target_email)).delete(
            synchronize_session=False
        )
        db.commit()
    except SQLAlchemyError:
        try:
            db.rollback()
        except SQLAlchemyError:
            pass  # dead connection: the password is changed, the answer is still 204
        logger.warning("Password reset: could not clear the login lockout; it ends with its window.")
    return Response(status_code=204)
