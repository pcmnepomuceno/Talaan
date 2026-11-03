from fastapi import APIRouter, Depends, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app import config
from app.auth import rate_limit
from app.auth.cookies import clear_session_cookie
from app.auth.dependencies import get_current_user
from app.auth.models import RateLimitEvent
from app.auth.security import verify_password
from app.database import get_db
from app.users.models import User
from app.users.schemas import AccountDelete, UserRead

"""User-related API routes."""

router = APIRouter(tags=["users"])


@router.get("/me", response_model=UserRead)
def read_current_user(current_user: User = Depends(get_current_user)) -> User:
	"""Return the currently authenticated user's profile."""
	return current_user


@router.post("/account/delete", status_code=204)
def delete_account(
	body: AccountDelete,
	request: Request,
	current_user: User = Depends(get_current_user),
	db: Session = Depends(get_db),
):
	"""Permanently delete the caller and all their data (hard delete; DECISIONS.md, M10)."""
	# Plain values now: enforce() commits, which expires current_user, and a concurrent
	# delete could remove the row before we read it again.
	user_id, email, password_hash = current_user.id, current_user.email, current_user.password_hash
	user_key = f"account-delete:user:{user_id}"

	# Limits first, committed before bcrypt (as in login). On success the user key is deleted
	# below, so a correct password leaves nothing behind in the user budget.
	rate_limit.enforce(
		db,
		("account-delete:ip:" + rate_limit.client_ip(request),
		 config.ACCOUNT_DELETE_IP_LIMIT, config.ACCOUNT_DELETE_IP_WINDOW_SECONDS),
		(user_key, config.ACCOUNT_DELETE_USER_LIMIT, config.ACCOUNT_DELETE_USER_WINDOW_SECONDS),
	)

	# 403, not 401: the frontend treats 401 as "session expired" and would log the user out.
	if not verify_password(body.password, password_hash):
		raise HTTPException(status_code=403, detail="Incorrect password.")

	# One transaction. FOR UPDATE serializes concurrent deletes of the same user: the loser
	# waits, then finds no row. The cascades remove applications, interviews and sessions;
	# invite_codes.used_by_user_id becomes NULL (the code stays used).
	with rate_limit.fail_closed(db):
		locked = db.execute(
			text("SELECT id FROM users WHERE id = :id FOR UPDATE"), {"id": user_id}
		).first()
		keys = [user_key] if locked is None else [user_key, rate_limit.email_key(email)]
		db.query(RateLimitEvent).filter(RateLimitEvent.key.in_(keys)).delete(synchronize_session=False)
		if locked is not None:
			db.query(User).filter(User.id == user_id).delete(synchronize_session=False)
		db.commit()
	if locked is None:
		# Lost a race with another delete: the account is gone, so drop the dead cookie too.
		response = JSONResponse({"detail": "Not authenticated"}, status_code=401)
		clear_session_cookie(response)
		return response

	response = Response(status_code=204)
	clear_session_cookie(response)
	return response
