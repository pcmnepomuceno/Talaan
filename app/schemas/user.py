"""Pydantic schemas: User request/response bodies.

Stub — request validation is yours to write (CLAUDE.md rule 2).
Typical set: UserCreate (email + raw password in), UserRead (no password out).
"""
from pydantic import BaseModel, ConfigDict, EmailStr, field_validator
# TODO: implement User schemas

class UserCreate(BaseModel):
    email: EmailStr
    password: str
    account_name: str

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
        return value

class UserRead(BaseModel):
    id: int
    email: EmailStr
    account_name: str

    model_config = ConfigDict(from_attributes=True)

class UserLogin(BaseModel):
    email: EmailStr
    password: str