"""SQLAlchemy model: Sessions.

Stub — see the Sessions table in CLAUDE.md for the column spec.
Notes: `token_hash` is unique (SHA-256 hex of the token in the user's
cookie; the raw token is never stored); `user_id` is a foreign key to Users.id (the FK lives here only).
"""

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)

from app.database import Base


class Session(Base):
    __tablename__ = "sessions"
    id = Column(Integer, primary_key=True)
    token_hash = Column(String, unique=True, nullable=False)  # SHA-256 hex of the cookie token
    user_id = Column(Integer, ForeignKey("users.id"), nullable=False)  # Foreign key to Users.id
    created_at = Column(DateTime(timezone=True), nullable=False)  # Timestamp of session creation
    expires_at = Column(DateTime(timezone=True), nullable=False)  # Timestamp of session expiration


class RateLimitEvent(Base):
    """One attempt for a limiter key (e.g. `login:ip:1.2.3.4`). Emails appear only as SHA-256."""

    __tablename__ = "rate_limit_events"
    __table_args__ = (Index("ix_rate_limit_events_key_created_at", "key", "created_at"),)
    id = Column(BigInteger, primary_key=True)
    key = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
