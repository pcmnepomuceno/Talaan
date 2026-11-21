"""Pydantic schemas for the admin invite endpoints. Never a code hash, email or (except in
InviteCreated, once) a code."""

from datetime import datetime

from pydantic import BaseModel


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
