"""The session cookie: the one place its name and attributes are defined.

HttpOnly, SameSite=Lax, Path=/, no Domain. With COOKIE_SECURE the name gets the `__Host-`
prefix, which browsers accept only with Secure, Path=/ and no Domain. SameSite=None is
never used (DECISIONS.md, M10). Config is read at call time so tests can patch it.
"""

from fastapi import Request, Response

from app import config

BASE_NAME = "session_token"


def cookie_name() -> str:
    return f"__Host-{BASE_NAME}" if config.COOKIE_SECURE else BASE_NAME


def read_session_token(request: Request) -> str | None:
    return request.cookies.get(cookie_name())


def _attrs() -> dict:
    return {"path": "/", "httponly": True, "secure": config.COOKIE_SECURE, "samesite": "lax"}


def set_session_cookie(response: Response, token: str, max_age: int) -> None:
    response.set_cookie(key=cookie_name(), value=token, max_age=max_age, **_attrs())


def clear_session_cookie(response: Response) -> None:
    response.delete_cookie(key=cookie_name(), **_attrs())
