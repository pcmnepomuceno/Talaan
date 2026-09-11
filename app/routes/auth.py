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

from fastapi import APIRouter

router = APIRouter(tags=["auth"])


# TODO: implement POST /signup
# TODO: implement POST /login
# TODO: implement POST /logout
