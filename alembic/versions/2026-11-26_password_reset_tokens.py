"""password_reset_tokens

Single-use, expiring password reset links. Only the SHA-256 of a token is stored. Rows go with
their account; created_by (the admin) is SET NULL when that account is deleted. Both FK columns
are indexed so deleting a user does not scan the table.

Revision ID: f3a9c6d41b85
Revises: e1a7c5d93b28
Create Date: 2026-11-26 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "f3a9c6d41b85"
down_revision: Union[str, Sequence[str], None] = "e1a7c5d93b28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "password_reset_tokens",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column(
            "user_id",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_password_reset_tokens_user_id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("token_hash", sa.String(), nullable=False, unique=True),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_by",
            sa.Integer(),
            sa.ForeignKey("users.id", name="fk_password_reset_tokens_created_by", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index("ix_password_reset_tokens_user_id", "password_reset_tokens", ["user_id"])
    op.create_index("ix_password_reset_tokens_created_by", "password_reset_tokens", ["created_by"])


def downgrade() -> None:
    op.drop_index("ix_password_reset_tokens_created_by", table_name="password_reset_tokens")
    op.drop_index("ix_password_reset_tokens_user_id", table_name="password_reset_tokens")
    op.drop_table("password_reset_tokens")
