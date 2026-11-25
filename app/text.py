"""Text every free-text input must pass. Postgres rejects NUL, and a lone surrogate cannot be
UTF-8 encoded (database driver, bcrypt, hashing): both would be a 500. Rejected, never stripped.
Passwords that are only verified, never stored, use `check_encodable` (with a 1024 cap):
bcrypt handles NUL."""

import re
from typing import Annotated

from pydantic import AfterValidator

_SURROGATE = re.compile("[\ud800-\udfff]")


def check_encodable(v: str | None) -> str | None:
    if v is not None and _SURROGATE.search(v):
        raise ValueError("Must not contain invalid Unicode characters.")
    return v


def check(v: str | None) -> str | None:
    if v is not None and "\x00" in v:
        raise ValueError("Must not contain null characters.")
    return check_encodable(v)


Text = Annotated[str, AfterValidator(check)]
