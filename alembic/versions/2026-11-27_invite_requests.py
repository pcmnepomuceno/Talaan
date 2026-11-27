"""invite_requests

Public requests for an invite code. The requester keeps a private status link; only the SHA-256 of
its token is stored. `code_plain` holds the invite code from approval until the requester sees it,
or until purge clears it. invite_id is SET NULL when the invite is revoked, and indexed so a revoke
does not scan the table. No IP column.

Revision ID: b8d3f1a6c27e
Revises: a7c2e9d05b14
Create Date: 2026-11-27 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "b8d3f1a6c27e"
down_revision: Union[str, Sequence[str], None] = "a7c2e9d05b14"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

status = postgresql.ENUM("pending", "approved", "rejected", name="invite_request_status")


def upgrade() -> None:
    op.create_table(
        "invite_requests",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("contact", sa.Text(), nullable=False),
        sa.Column("note", sa.Text(), nullable=False),
        sa.Column("status", status, nullable=False),
        sa.Column("status_token_hash", sa.String(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "invite_id",
            sa.Integer(),
            sa.ForeignKey("invite_codes.id", name="fk_invite_requests_invite_id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("code_plain", sa.Text(), nullable=True),
        sa.Column("revealed_at", sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index("ix_invite_requests_invite_id", "invite_requests", ["invite_id"])


def downgrade() -> None:
    op.drop_index("ix_invite_requests_invite_id", table_name="invite_requests")
    op.drop_table("invite_requests")
    status.drop(op.get_bind(), checkfirst=True)
