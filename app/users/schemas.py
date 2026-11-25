"""Pydantic schemas: User request/response bodies.

Stub — request validation is yours to write (CLAUDE.md rule 2).
Typical set: UserCreate (email + raw password in), UserRead (no password out).
"""
from typing import Annotated

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    computed_field,
    field_validator,
)

from app import config, text

# TODO: implement User schemas

class UserCreate(BaseModel):
    email: EmailStr
    password: text.Text
    account_name: text.Text
    # Required. No max_length here on purpose: pydantic would answer an over-length code with
    # a 422, which differs from the generic 400 every other bad code gets. The route bounds it.
    invite_code: str

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        if value is None:
            return value
        return str(value).strip().lower()

    @field_validator("password")
    @classmethod
    def check_password_rules(cls, value: str) -> str:
        # checks if there is atleast one uppercase letter, one lowercase letter, one digit, and one special character
        if not any(c.isupper() for c in value):
            raise ValueError("Password must contain at least one uppercase letter.")
        if not any(c.islower() for c in value):
            raise ValueError("Password must contain at least one lowercase letter.")
        if not any(c.isdigit() for c in value):
            raise ValueError("Password must contain at least one digit.")
        if not any(c in "!@#$%^&*()-_=+[]{}|;:'\",.<>?/`~" for c in value):
            raise ValueError("Password must contain at least one special character.")
        if len(value) < 8:
            raise ValueError("Password must be at least 8 characters long.")
        if len(value.encode("utf-8")) > 72:
            raise ValueError("Password must be at most 72 bytes long.")
        return value

class UserRead(BaseModel):
    id: int
    email: EmailStr
    account_name: str

    model_config = ConfigDict(from_attributes=True)

    @computed_field
    @property
    def is_admin(self) -> bool:
        return config.is_admin(self.email)

class UserLogin(BaseModel):
    email: EmailStr
    # Verify-only, like AccountDelete: a lone surrogate is a 422, NUL is accepted, and any
    # other wrong value up to the cap is a 401. The cap stops a huge body being scanned,
    # encoded and rate-limit-counted per attempt; it runs before the character check, so an
    # over-long value keeps its `string_too_long`. Signup caps passwords at 72 bytes.
    password: Annotated[
        str, Field(max_length=1024), AfterValidator(text.check_encodable)
    ]

    @field_validator("email", mode="before")
    @classmethod
    def normalize_email(cls, value: str) -> str:
        if value is None:
            return value
        return str(value).strip().lower()


class AccountDelete(BaseModel):
    # No complexity rules. A lone surrogate is a 422, because it cannot be encoded for bcrypt.
    # NUL is accepted, because bcrypt handles it and nothing is stored. Any other wrong value up
    # to the cap, however odd (empty, over 72 bytes), gets the same 403.
    # The cap only stops a huge body being parsed and encoded per attempt.
    # Length before the character check, so an over-long value keeps its `string_too_long`.
    password: Annotated[str, Field(max_length=1024), AfterValidator(text.check_encodable)]
