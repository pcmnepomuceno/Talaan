"""Pydantic schemas: User request/response bodies.

Stub — request validation is yours to write (CLAUDE.md rule 2).
Typical set: UserCreate (email + raw password in), UserRead (no password out).
"""
from pydantic import BaseModel, ConfigDict, EmailStr
# TODO: implement User schemas

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    account_name: str

class UserRead(BaseModel):
    id: int
    email: EmailStr
    account_name: str

    model_config = ConfigDict(from_attributes=True)