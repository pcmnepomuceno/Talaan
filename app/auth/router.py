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

from fastapi import APIRouter, Depends, HTTPException, Request, Response
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app import config
from app.auth import invites, rate_limit
from app.auth.cookies import (
    clear_session_cookie,
    read_session_token,
    set_session_cookie,
)
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

FOREIGN_KEY_VIOLATION = "23503"  # Postgres SQLSTATE

router = APIRouter(tags=["auth"])

SESSION_LIFETIME = timedelta(days=30)


@router.post("/signup")
def signup(user_data: UserCreate, request: Request, db: Session = Depends(get_db)):
    ip_key = "signup:ip:" + rate_limit.client_ip(request)
    rate_limit.enforce(db, (ip_key, config.SIGNUP_IP_LIMIT, config.SIGNUP_IP_WINDOW_SECONDS))

    # Invite code before the duplicate-email check: only code holders can learn whether an
    # email exists. Non-consuming here; the code is consumed below with the user insert.
    body = invites.normalize(user_data.invite_code)
    if body is None:
        raise invites.invalid()
    code_hash = invites.hash_code(body)
    if not invites.is_valid(db, code_hash):
        raise invites.invalid()

    normalized_email = user_data.email  # stripped and lowercased by the schema validator

    #Check if email already exists
    existing_user = db.query(UserModel).filter(UserModel.email == normalized_email).first()
    if existing_user:
        raise HTTPException(status_code=400, detail="Email already exists.")

    # Hash the password
    hashed_password = hash_password(user_data.password)

    # One transaction: create the user, then consume the code. If another signup took the
    # code in between, consume() matches no row: roll the user back, same generic error.
    user = UserModel(
        email=normalized_email,
        password_hash=hashed_password,
        account_name=user_data.account_name
    )
    db.add(user)
    try:
        db.flush()
        if not invites.consume(db, code_hash, user.id):
            db.rollback()
            raise invites.invalid()
        db.commit()
    except IntegrityError:
        # A concurrent signup with the same email passed the check above and committed
        # first; our INSERT hit the unique index. The rollback keeps the code unused.
        db.rollback()
        raise HTTPException(status_code=400, detail="Email already exists.") from None
    db.refresh(user)

    return UserRead.model_validate(user)

@router.post("/login")
def login(
    user_data: UserLogin, request: Request, response: Response, db: Session = Depends(get_db)
):
    normalized_email = user_data.email  # stripped and lowercased by the schema validator
    ip_key = "login:ip:" + rate_limit.client_ip(request)
    em_key = rate_limit.email_key(normalized_email)

    # Limits first. Both attempts are committed before bcrypt runs: concurrent guesses see
    # each other (the race window is this short transaction, not a bcrypt run), and a
    # dropped connection still counts. A success deletes only its own email row below.
    event_ids = rate_limit.enforce(
        db,
        (ip_key, config.LOGIN_IP_LIMIT, config.LOGIN_IP_WINDOW_SECONDS),
        (em_key, config.LOGIN_EMAIL_LIMIT, config.LOGIN_EMAIL_WINDOW_SECONDS),
    )

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

    # Only this attempt's email row: other failures (another client's guesses) stay counted,
    # and the IP row stays. Committed together with the session below.
    with rate_limit.fail_closed(db):
        rate_limit.delete_event(db, event_ids[em_key])

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
    try:
        db.commit()
    except IntegrityError as e:
        # Only a foreign key violation (23503) means the account was deleted between the
        # password check and this insert (the FK insert waited for the delete to commit).
        # No session row exists; same 401. Any other integrity error is a real bug: re-raise.
        db.rollback()
        if getattr(e.orig, "pgcode", None) != FOREIGN_KEY_VIOLATION:
            raise
        raise HTTPException(status_code=401, detail="Invalid email or password.") from None
    db.refresh(session)

    set_session_cookie(response, session_token, int(SESSION_LIFETIME.total_seconds()))

    return {"detail": "Logged in"}

@router.post("/logout", status_code=204)
def logout(request: Request, db: Session = Depends(get_db)):
    # Idempotent: missing/invalid token is not an error (DECISIONS.md)
    session_token = read_session_token(request)
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
    clear_session_cookie(response)
    return response
