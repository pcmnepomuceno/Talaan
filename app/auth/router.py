"""Auth routes: signup, login, logout.

Left as stubs on purpose (CLAUDE.md rule 2) — write these yourself.

POST /signup — take email/password (+ account_name), hash the password
    (never store it raw), create a User row.
POST /login  — look up the user by email, verify the password against
    password_hash, create a Session row, and return the session_token
    (typically set on an HttpOnly cookie).
POST /logout — identify the caller's session (cookie/header) and invalidate
    it (delete the row, or mark it revoked if you added that column).

See app/models/user.py, app/models/session.py, app/schemas/user.py and
app/schemas/session.py for the pieces these will need.
"""

from datetime import datetime, timedelta, timezone
from fastapi import APIRouter, Cookie, Depends, HTTPException, Response
from app.auth.models import Session as SessionModel
from sqlalchemy.orm import Session
from app.users.schemas import UserCreate, UserRead, UserLogin
from app.users.models import User as UserModel
from app.auth.security import hash_password, verify_password, generate_session_token
from app.database import get_db

router = APIRouter(tags=["auth"])

SESSION_LIFETIME = timedelta(days=30)


@router.post("/signup")
def signup(user_data: UserCreate, db: Session = Depends(get_db)):
    normalized_email = user_data.email.lower()

    #Check if email already exists
    existing_user = db.query(UserModel).filter(UserModel.email == normalized_email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists.")

    # Hash the password
    hashed_password = hash_password(user_data.password)

    # Create a new user
    user = UserModel(
        email=normalized_email,
        password_hash=hashed_password,
        account_name=user_data.account_name
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    return UserRead.model_validate(user)

@router.post("/login")
def login(user_data: UserLogin, response: Response, db: Session = Depends(get_db)):
    normalized_email = user_data.email.lower()

    # Look up the user by email
    user = db.query(UserModel).filter(UserModel.email == normalized_email).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    # Verify the password
    if not verify_password(user_data.password, user.password_hash):
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    # Generate a session token
    session_token = generate_session_token()

    # Create a new session
    session = SessionModel(
        user_id=user.id,
        token=session_token,
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + SESSION_LIFETIME
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    response.set_cookie(
        key="session_token",
        value=session.token,
        httponly=True,
        max_age=int(SESSION_LIFETIME.total_seconds()),
    )

    return {"detail": "Logged in"}

@router.post("/logout", status_code=204)
def logout(session_token: str = Cookie(None), db: Session = Depends(get_db)):
    # Idempotent: missing/invalid token is not an error (DECISIONS.md)
    session = db.query(SessionModel).filter(SessionModel.token == session_token).first()
    if session:
        db.delete(session)
        db.commit()

    # Cookie must be cleared on the returned response object
    response = Response(status_code=204)
    response.delete_cookie(key="session_token")
    return response
