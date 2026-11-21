"""Pydantic schemas for the admin invite endpoints. Never a code hash, email or (except in
InviteCreated, once) a code."""

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


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
    # Any wrong value up to the cap gets the same 403, like AccountDelete.
    password: str = Field(max_length=1024)

    @field_validator("note", mode="before")
    @classmethod
    def strip_note(cls, value):
        if isinstance(value, str):
            return value.strip() or None
        return value


class InviteCreated(BaseModel):
    """The one place a plaintext code leaves the server."""

    id: int
    code: str
    note: str | None
    expires_at: datetime
