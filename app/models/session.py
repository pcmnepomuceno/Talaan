"""SQLAlchemy model: Sessions.

Stub — see the Sessions table in CLAUDE.md for the column spec.
Notes: `session_token` is unique (this is what gets set in the user's
cookie); `user_id` is a foreign key to Users.id (the FK lives here only).
"""

from app.database import Base
from sqlalchemy import Column, Integer, String, DateTime, ForeignKey

class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True)
    session_token = Column(String, unique=True, nullable=False)
    user_id = Column(ForeignKey("users.id"), nullable=False)  # Foreign key to Users.id
    created_at = Column(DateTime, nullable=False)  # Timestamp of session creation
    expired_at = Column(DateTime, nullable=True)  # Timestamp of session expiration