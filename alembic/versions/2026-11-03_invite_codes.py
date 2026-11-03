"""invite_codes

Single-use, expiring signup invites. Only the SHA-256 of a code is stored.
used_by_user_id is ON DELETE SET NULL so deleting an account never fails, and indexed
so that delete does not scan invite_codes.

Revision ID: b7d4a1e93c52
Revises: 8c2e5d1f7a90
Create Date: 2026-11-03 12:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'b7d4a1e93c52'
down_revision: Union[str, Sequence[str], None] = '8c2e5d1f7a90'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "invite_codes",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("code_hash", sa.String(), nullable=False, unique=True),
        sa.Column("note", sa.Text(), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "used_by_user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_invite_codes_used_by_user_id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    # The FK side of ON DELETE SET NULL: without it, every user delete scans the table.
    op.create_index("ix_invite_codes_used_by_user_id", "invite_codes", ["used_by_user_id"])


def downgrade() -> None:
    op.drop_index("ix_invite_codes_used_by_user_id", table_name="invite_codes")
    op.drop_table("invite_codes")
