"""SQLAlchemy model: Interviews.

See the Interviews table in CLAUDE.md for the column spec.
`job_application_id` is a foreign key to Job Applications.id (the FK lives
here only). Enum values are stored lowercase (`values_callable`).
"""

import enum

from sqlalchemy import Column, DateTime, Enum, ForeignKey, Integer, String, Text, func

from app.database import Base


class InterviewMode(str, enum.Enum):
    ON_SITE = "on_site"
    ONLINE = "online"
    ASYNC = "async"


class InterviewOutcome(str, enum.Enum):
    PENDING = "pending"
    GOOD = "good"
    BAD = "bad"


def _values(enum_cls):
    return [m.value for m in enum_cls]


class Interview(Base):
    __tablename__ = "interviews"

    id = Column(Integer, primary_key=True)
    job_application_id = Column(
        Integer, ForeignKey("job_applications.id", ondelete="CASCADE"), nullable=False, index=True
    )
    interviewer = Column(String, nullable=True)  # async interviews may have none
    scheduled_at = Column(DateTime(timezone=True), nullable=False)
    mode = Column(
        Enum(InterviewMode, name="interview_mode", values_callable=_values),
        nullable=False,
    )
    outcome = Column(
        Enum(InterviewOutcome, name="interview_outcome", values_callable=_values),
        nullable=False,
        default=InterviewOutcome.PENDING,
        server_default=InterviewOutcome.PENDING.value,
    )
    remarks = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
