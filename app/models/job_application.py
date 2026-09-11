"""SQLAlchemy model: Job Applications.

Stub — see the Job Applications table in CLAUDE.md for the column spec.
Notes: `status` and `mode_of_work` are enums; `created_by` is a foreign key
to Users.id (the FK lives here, on the "many" side, only).
"""

from app.database import Base
from sqlalchemy import Column, Integer, String, ForeignKey, DateTime

# TODO: implement the JobApplication model
class JobApplication(Base):
    __tablename__ = "job_applications"
    id = Column(Integer, primary_key=True)
    job_title = Column(String, nullable=False)
    company_name = Column(String, nullable=False)
    status = Column(String, nullable=False)  # Enum: e.g., "applied", "interviewing", "offer", "rejected"
    mode_of_work = Column(String, nullable=False)  # Enum: e.g., "remote", "onsite", "hybrid"
    created_by = Column(Integer, ForeignKey("users.id"), nullable=False)  # Foreign key to Users.id
    created_at = Column(DateTime, nullable=False)  # Timestamp of application creation
    updated_at = Column(DateTime, nullable=True)  # Timestamp of last update