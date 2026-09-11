from datetime import datetime, timezone

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session as DBSession

from .database import get_db
from .models import Session, User


def get_current_user(
	session_token: str = Cookie(None),
	db: DBSession = Depends(get_db),
) -> User:
	session = db.query(Session).filter(Session.token == session_token).first()

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
