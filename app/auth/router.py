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

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response
from sqlalchemy.orm import Session

from app import config
from app.auth import rate_limit
from app.auth.models import Session as SessionModel
from app.auth.security import (
    DUMMY_PASSWORD_HASH,
    generate_session_token,
    hash_password,
    hash_session_token,
    verify_password,
)
from app.database import get_db
from app.users.models import User as UserModel
from app.users.schemas import UserCreate, UserLogin, UserRead

router = APIRouter(tags=["auth"])

SESSION_LIFETIME = timedelta(days=30)


@router.post("/signup")
def signup(user_data: UserCreate, request: Request, db: Session = Depends(get_db)):
    ip_key = "signup:ip:" + rate_limit.client_ip(request)
    with rate_limit.fail_closed(db):
        wait = rate_limit.check(db, ip_key, config.SIGNUP_IP_LIMIT, config.SIGNUP_IP_WINDOW_SECONDS)
        if wait is None:
            rate_limit.record(db, ip_key)
        db.commit()  # keeps the prune, and the attempt counts even if the client disconnects
    if wait is not None:
        raise rate_limit.too_many(wait)

    normalized_email = user_data.email  # stripped and lowercased by the schema validator

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
def login(
    user_data: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)
):
    normalized_email = user_data.email  # stripped and lowercased by the schema validator
    ip_key = "login:ip:" + rate_limit.client_ip(request)
    em_key = rate_limit.email_key(normalized_email)

    # Limits first. Blocked attempts are not recorded, so a lockout ends with its window.
    # Both attempts are committed before bcrypt runs: concurrent guesses see each other
    # (the race window is this short transaction, not a bcrypt run), and a dropped
    # connection still counts. A success clears the email key below.
    with rate_limit.fail_closed(db):
        waits = [
            rate_limit.check(db, ip_key, config.LOGIN_IP_LIMIT, config.LOGIN_IP_WINDOW_SECONDS),
            rate_limit.check(
                db, em_key, config.LOGIN_EMAIL_LIMIT, config.LOGIN_EMAIL_WINDOW_SECONDS
            ),
        ]
        waits = [w for w in waits if w is not None]
        if not waits:
            rate_limit.record(db, ip_key)
            rate_limit.record(db, em_key)
        db.commit()
    if waits:
        raise rate_limit.too_many(max(waits))

    # Look up the user by email
    user = db.query(UserModel).filter(UserModel.email == normalized_email).first()

    # Verify exactly once, with no early return: an unknown email checks the dummy hash,
    # so it costs the same as a wrong password and the two are indistinguishable.
    password_ok = verify_password(
        user_data.password, user.password_hash if user else DUMMY_PASSWORD_HASH
    )
    if not user or not password_ok:
        # Recorded above. Unknown emails count too, or only real accounts could ever be
        # locked (a leak).
        raise HTTPException(status_code=401, detail="Invalid email or password.")

    with rate_limit.fail_closed(db):
        rate_limit.clear(db, em_key)  # committed together with the session below

    # Generate a session token
    session_token = generate_session_token()

    # Create a new session
    session = SessionModel(
        user_id=user.id,
        token_hash=hash_session_token(session_token),
        created_at=datetime.now(timezone.utc),
        expires_at=datetime.now(timezone.utc) + SESSION_LIFETIME
    )
    db.add(session)
    db.commit()
    db.refresh(session)

    response.set_cookie(
        key="session_token",
        value=session_token,
        httponly=True,
        max_age=int(SESSION_LIFETIME.total_seconds()),
    )

    return {"detail": "Logged in"}

@router.post("/logout", status_code=204)
def logout(session_token: str = Cookie(None), db: Session = Depends(get_db)):
    # Idempotent: missing/invalid token is not an error (DECISIONS.md)
    session = None
    if session_token:
        session = (
            db.query(SessionModel)
            .filter(SessionModel.token_hash == hash_session_token(session_token))
            .first()
        )
    if session:
        db.delete(session)
        db.commit()

    # Cookie must be cleared on the returned response object
    response = Response(status_code=204)
    response.delete_cookie(key="session_token")
    return response
