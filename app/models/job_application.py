"""SQLAlchemy model: Job Applications.

See the Job Applications table in CLAUDE.md for the column spec.
`created_by` is a foreign key to Users.id (the FK lives here, on the "many"
side, only). Enum values are stored lowercase (`values_callable`), not as
member names.
"""

import enum

from sqlalchemy import Column, Date, DateTime, Enum, ForeignKey, Integer, String, Text, func

from app.database import Base


class ApplicationStatus(str, enum.Enum):
    APPLIED = "applied"
    SCREENING = "screening"
    INTERVIEWING = "interviewing"
    OFFERED = "offered"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    GHOSTED = "ghosted"


class ModeOfWork(str, enum.Enum):
    ON_SITE = "on_site"
    HYBRID = "hybrid"
    REMOTE = "remote"


def _values(enum_cls):
    return [m.value for m in enum_cls]


class JobApplication(Base):
    __tablename__ = "job_applications"

    id = Column(Integer, primary_key=True)
    company = Column(String, nullable=False)
    job_name = Column(String, nullable=False)
    contact_website = Column(String, nullable=True)
    contact_email = Column(String, nullable=True)
    status = Column(
        Enum(ApplicationStatus, name="application_status", values_callable=_values),
        nullable=False,
    )
    salary = Column(Integer, nullable=True)
    mode_of_work = Column(
        Enum(ModeOfWork, name="mode_of_work", values_callable=_values),
        nullable=False,
    )
    remarks = Column(Text, nullable=True)
    date_applied = Column(Date, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(
        DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now()
    )
    created_by = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )
