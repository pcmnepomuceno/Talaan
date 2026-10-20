"""saved_status_nullable_date_applied

Revision ID: ca793c851e6f
Revises: 86b5f2568421
Create Date: 2026-10-21 00:54:53.528250

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'ca793c851e6f'
down_revision: Union[str, Sequence[str], None] = '86b5f2568421'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


OLD_STATUSES = (
    "applied", "screening", "interviewing", "offered",
    "accepted", "rejected", "withdrawn", "ghosted",
)


def upgrade() -> None:
    op.execute("ALTER TYPE application_status ADD VALUE IF NOT EXISTS 'saved' BEFORE 'applied'")
    op.alter_column("job_applications", "date_applied", nullable=True)


def downgrade() -> None:
    # Postgres cannot drop an enum value, and these rows cannot satisfy the old schema.
    bad = op.get_bind().execute(
        sa.text(
            "SELECT count(*) FROM job_applications "
            "WHERE status = 'saved' OR date_applied IS NULL"
        )
    ).scalar()
    if bad:
        raise RuntimeError(
            f"Cannot downgrade: {bad} job_applications row(s) have status 'saved' or a NULL "
            "date_applied. Delete them, or set a real status and date_applied, then retry."
        )
    op.alter_column("job_applications", "date_applied", nullable=False)
    op.execute("ALTER TYPE application_status RENAME TO application_status_old")
    new_type = sa.Enum(*OLD_STATUSES, name="application_status")
    new_type.create(op.get_bind())
    op.execute(
        "ALTER TABLE job_applications ALTER COLUMN status TYPE application_status "
        "USING status::text::application_status"
    )
    op.execute("DROP TYPE application_status_old")
