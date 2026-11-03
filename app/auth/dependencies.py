from datetime import datetime, timezone

from fastapi import Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DBSession

from app.auth.cookies import read_session_token
from app.auth.models import Session
from app.auth.security import hash_session_token
from app.database import get_db
from app.users.models import User


def get_current_user(
	request: Request,
	db: DBSession = Depends(get_db),
) -> User:
	session_token = read_session_token(request)
	session = None
	if session_token:
		session = (
			db.query(Session)
			.filter(Session.token_hash == hash_session_token(session_token))
			.first()
		)

	if session is None:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Not authenticated",
		)

	if session.expires_at <= datetime.now(timezone.utc):
		db.delete(session)
		db.commit()
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Session expired",
		)

	user = db.query(User).filter(User.id == session.user_id).first()
	if user is None:
		raise HTTPException(
			status_code=status.HTTP_401_UNAUTHORIZED,
			detail="Not authenticated",
		)

	return user
