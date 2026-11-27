"""SQLAlchemy model: Sessions.

Stub — see the Sessions table in CLAUDE.md for the column spec.
Notes: `token_hash` is unique (SHA-256 hex of the token in the user's
cookie; the raw token is never stored); `user_id` is a foreign key to Users.id (the FK lives here only).
"""

import enum

from sqlalchemy import (
    BigInteger,
    Column,
    DateTime,
    Enum,
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
    user_id = Column(
        Integer, ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True
    )  # Foreign key to Users.id
    created_at = Column(DateTime(timezone=True), nullable=False)  # Timestamp of session creation
    expires_at = Column(DateTime(timezone=True), nullable=False)  # Timestamp of session expiration


class InviteCode(Base):
    """Single-use signup invite. Only the SHA-256 of the normalized code is stored.
    `used_by_user_id` is SET NULL when that user is deleted, so account deletion never fails."""

    __tablename__ = "invite_codes"
    __table_args__ = (Index("ix_invite_codes_used_by_user_id", "used_by_user_id"),)
    id = Column(Integer, primary_key=True)
    code_hash = Column(String, unique=True, nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    used_by_user_id = Column(
        Integer,
        ForeignKey("users.id", name="fk_invite_codes_used_by_user_id", ondelete="SET NULL"),
        nullable=True,
    )


class PasswordResetToken(Base):
    """Single-use password reset link. Only the SHA-256 of the token is stored. Rows go with the
    account (CASCADE), and with the admin who made them (`created_by`, CASCADE): a deleted admin's
    links must not turn into NULL, which is how a CLI link looks."""

    __tablename__ = "password_reset_tokens"
    __table_args__ = (
        Index("ix_password_reset_tokens_user_id", "user_id"),
        Index("ix_password_reset_tokens_created_by", "created_by"),
    )
    id = Column(Integer, primary_key=True)
    user_id = Column(
        Integer,
        ForeignKey("users.id", name="fk_password_reset_tokens_user_id", ondelete="CASCADE"),
        nullable=False,
    )
    token_hash = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    used_at = Column(DateTime(timezone=True), nullable=True)
    created_by = Column(
        Integer,
        ForeignKey("users.id", name="fk_password_reset_tokens_created_by", ondelete="CASCADE"),
        nullable=True,
    )


class InviteRequestStatus(enum.Enum):
    pending = "pending"
    approved = "approved"
    rejected = "rejected"


class InviteRequest(Base):
    """A public request for an invite. Only the SHA-256 of the status-link token is stored.
    `code_plain` holds the invite code from approval until it is shown once or purged
    (DECISIONS.md, 2026-11-27). `invite_id` is SET NULL when the invite is revoked."""

    __tablename__ = "invite_requests"
    __table_args__ = (Index("ix_invite_requests_invite_id", "invite_id"),)
    id = Column(Integer, primary_key=True)
    contact = Column(Text, nullable=False)
    note = Column(Text, nullable=False)
    status = Column(
        Enum(InviteRequestStatus, name="invite_request_status", values_callable=lambda e: [m.value for m in e]),
        nullable=False,
    )
    status_token_hash = Column(String, unique=True, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    invite_id = Column(
        Integer,
        ForeignKey("invite_codes.id", name="fk_invite_requests_invite_id", ondelete="SET NULL"),
        nullable=True,
    )
    code_plain = Column(Text, nullable=True)
    revealed_at = Column(DateTime(timezone=True), nullable=True)


class RateLimitEvent(Base):
    """One attempt for a limiter key (e.g. `login:ip:1.2.3.4`). Emails appear only as SHA-256."""

    __tablename__ = "rate_limit_events"
    __table_args__ = (Index("ix_rate_limit_events_key_created_at", "key", "created_at"),)
    id = Column(BigInteger, primary_key=True)
    key = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False)
