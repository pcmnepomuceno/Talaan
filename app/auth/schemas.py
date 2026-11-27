"""Pydantic schemas for the admin invite, password reset and invite request endpoints. Responses
never hold a hash or an account email, and a code or token appears only once: in its *Created or
*Approved model, or in the one reveal of InviteRequestState."""

from datetime import datetime
from typing import Annotated, Literal

from pydantic import (
    AfterValidator,
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

from app import text
from app.users.schemas import NormalizedEmail, check_password_rules


class InviteItem(BaseModel):
    id: int
    status: str  # unused | used | expired
    note: str | None
    created_at: datetime
    expires_at: datetime
    used_at: datetime | None
    used_by_account_name: str | None  # None when unused, or when the user was deleted


class InviteList(BaseModel):
    items: list[InviteItem]


class InviteCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    note: str | None = Field(default=None, max_length=200)  # code points, after stripping
    expires_in_days: Literal[7, 14, 30]
    # Same rule as AccountDelete: a lone surrogate is a 422, NUL is accepted, and any other
    # wrong value up to the cap is a 403.
    password: Annotated[str, Field(max_length=1024), AfterValidator(text.check_encodable)]

    @field_validator("note", mode="before")
    @classmethod
    def strip_note(cls, value):
        if isinstance(value, str):
            text.check(value)  # before the strip and the length limit
            return value.strip() or None
        return value


class InviteCreated(BaseModel):
    """The one place a plaintext code leaves the server."""

    id: int
    code: str
    note: str | None
    expires_at: datetime


class PasswordResetCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    email: NormalizedEmail
    # Same rule as AccountDelete: verify-only.
    admin_password: Annotated[str, Field(max_length=1024), AfterValidator(text.check_encodable)]

class PasswordResetCreated(BaseModel):
    """The one place a plaintext reset token leaves the server."""

    token: str = Field(repr=False)
    expires_at: datetime


class PasswordReset(BaseModel):
    # No constraints on purpose (like invite_code): the route answers every bad token alike.
    token: str = Field(repr=False)
    new_password: Annotated[text.Text, AfterValidator(check_password_rules)] = Field(repr=False)


class InviteRequestCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    contact: str = Field(min_length=1, max_length=200)  # code points, after stripping
    note: str = Field(min_length=1, max_length=1000)
    # Honeypot. Never stored, and never validated: a 422 would tell a bot the field is special.
    website: str = ""

    @field_validator("contact", "note", mode="before")
    @classmethod
    def clean(cls, value):
        if isinstance(value, str):
            text.check(value)  # before the strip and the length limit
            return value.strip()
        return value


class InviteRequestCreated(BaseModel):
    """The one place a status token leaves the server."""

    token: str = Field(repr=False)


class InviteRequestStatusQuery(BaseModel):
    # No constraints on purpose: the route answers every bad token alike.
    token: str = Field(repr=False)


class InviteRequestState(BaseModel):
    state: Literal["pending", "rejected", "approved", "shown", "expired"]
    code: str | None = Field(default=None, repr=False)  # only with "approved", once


class InviteRequestItem(BaseModel):
    id: int
    contact: str
    note: str
    status: str  # pending | approved | rejected
    created_at: datetime
    decided_at: datetime | None
    revealed_at: datetime | None


class InviteRequestList(BaseModel):
    items: list[InviteRequestItem]


class InviteRequestApprove(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Same rule as AccountDelete: verify-only.
    password: Annotated[str, Field(max_length=1024), AfterValidator(text.check_encodable)]


class InviteRequestApproved(BaseModel):
    id: int  # the invite
    code: str = Field(repr=False)
    expires_at: datetime
