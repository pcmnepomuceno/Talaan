"""Pydantic schemas: Interview request/response bodies."""

from datetime import datetime
from typing import Annotated

from pydantic import (
    AfterValidator,
    AwareDatetime,
    BaseModel,
    ConfigDict,
    StringConstraints,
    model_validator,
)

from app.applications.schemas import Remarks
from app.interviews.models import InterviewMode, InterviewOutcome

# Whitespace-only is 422, like application names; null is the way to say "none".
Interviewer = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]


def _sane_range(v: datetime) -> datetime:
    # Extreme years with a non-UTC offset overflow during conversion (500); bound them instead.
    if not 1900 <= v.year <= 2200:
        raise ValueError("scheduled_at year must be between 1900 and 2200")
    return v


ScheduledAt = Annotated[AwareDatetime, AfterValidator(_sane_range)]


class InterviewCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    scheduled_at: ScheduledAt
    mode: InterviewMode
    outcome: InterviewOutcome = InterviewOutcome.PENDING
    interviewer: Interviewer | None = None
    remarks: Remarks | None = None


class InterviewUpdate(BaseModel):
    """All fields optional. Omitted = unchanged; explicit null clears interviewer/remarks only."""

    model_config = ConfigDict(extra="forbid")

    scheduled_at: ScheduledAt | None = None
    mode: InterviewMode | None = None
    outcome: InterviewOutcome | None = None
    interviewer: Interviewer | None = None
    remarks: Remarks | None = None

    @model_validator(mode="after")
    def _required_not_null(self):
        for f in ("scheduled_at", "mode", "outcome"):
            if f in self.model_fields_set and getattr(self, f) is None:
                raise ValueError(f"{f} cannot be null")
        return self


class InterviewRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    job_application_id: int
    interviewer: str | None
    scheduled_at: datetime
    mode: InterviewMode
    outcome: InterviewOutcome
    remarks: str | None
    created_at: datetime
    updated_at: datetime


class InterviewPage(BaseModel):
    items: list[InterviewRead]
    total: int
    limit: int
    offset: int
