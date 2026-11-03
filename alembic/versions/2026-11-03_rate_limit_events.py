"""rate_limit_events

Sliding-window counters for login/signup rate limiting, kept in Postgres
(Render free restarts and spins down, so memory counters would reset).

Revision ID: 8c2e5d1f7a90
Revises: 3f1c9a7d2b64
Create Date: 2026-11-03 09:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa

from alembic import op

# revision identifiers, used by Alembic.
revision: str = '8c2e5d1f7a90'
down_revision: Union[str, Sequence[str], None] = '3f1c9a7d2b64'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        "rate_limit_events",
        sa.Column("id", sa.BigInteger(), primary_key=True),
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_rate_limit_events_key_created_at", "rate_limit_events", ["key", "created_at"]
    )


def downgrade() -> None:
    op.drop_index("ix_rate_limit_events_key_created_at", table_name="rate_limit_events")
    op.drop_table("rate_limit_events")
