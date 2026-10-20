"""Pydantic schemas: Job Application request/response bodies."""

from datetime import date, datetime
from typing import Annotated

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
    HttpUrl,
    StringConstraints,
    model_validator,
)

from app.applications.models import ApplicationStatus, ModeOfWork

INT4_MAX = 2_147_483_647

Name = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
# HttpUrl accepts http/https only (javascript: etc. give 422); stored as str.
Website = Annotated[HttpUrl, Field(max_length=2000)]
Salary = Annotated[int, Field(ge=0, le=INT4_MAX)]
Remarks = Annotated[str, Field(max_length=5000)]


class ApplicationCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    company: Name
    job_name: Name
    contact_website: Website | None = None
    contact_email: EmailStr | None = None
    status: ApplicationStatus
    salary: Salary | None = None
    mode_of_work: ModeOfWork
    remarks: Remarks | None = None
    date_applied: date | None = None


class ApplicationUpdate(BaseModel):
    """All fields optional. Omitted = unchanged; explicit null clears nullable fields only."""

    model_config = ConfigDict(extra="forbid")

    company: Name | None = None
    job_name: Name | None = None
    contact_website: Website | None = None
    contact_email: EmailStr | None = None
    status: ApplicationStatus | None = None
    salary: Salary | None = None
    mode_of_work: ModeOfWork | None = None
    remarks: Remarks | None = None
    date_applied: date | None = None

    @model_validator(mode="after")
    def _required_not_null(self):
        for f in ("company", "job_name", "status", "mode_of_work"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"{f} cannot be null")
        return self


class ApplicationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    company: str
    job_name: str
    contact_website: str | None
    contact_email: str | None
    status: ApplicationStatus
    salary: int | None
    mode_of_work: ModeOfWork
    remarks: str | None
    date_applied: date | None
    created_at: datetime
    updated_at: datetime


class ApplicationPage(BaseModel):
    items: list[ApplicationRead]
    total: int
    limit: int
    offset: int
