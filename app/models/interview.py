"""SQLAlchemy model: Interviews.

Stub — see the Interviews table in CLAUDE.md for the column spec.
Notes: `mode` and `outcome` are enums; `job_application_id` is a foreign key
to Job Applications.id (the FK lives here only).
"""

from app.database import Base
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey

# TODO: implement the Interview model
class Interview(Base):
    __tablename__ = "interviews"
    id = Column(Integer, primary_key=True)
    job_application_id = Column(Integer, ForeignKey("job_applications.id"), nullable=False)  # Foreign key to Job Applications.id
    mode = Column(String, nullable=False)  # Enum: e.g., "phone", "video", "onsite"
    outcome = Column(String, nullable=True)  # Enum: e.g., "passed", "failed", "pending"
    scheduled_at = Column(DateTime(timezone=True), nullable=False)  # Timestamp of interview scheduling
    created_at = Column(DateTime(timezone=True), nullable=False)  # Timestamp of interview record creation
    updated_at = Column(DateTime(timezone=True), nullable=True)  # Timestamp of last update