"""job_applications.job_url and job_url_key

Two nullable columns (catalog-only on PG 16: no rewrite, no backfill) and a per-user index for
the duplicate lookup. `job_url_key` is the SHA-256 of the normalized URL.

Revision ID: e1a7c5d93b28
Revises: d4e8a2c61f07
Create Date: 2026-11-21 10:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'e1a7c5d93b28'
down_revision: Union[str, Sequence[str], None] = 'd4e8a2c61f07'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column('job_applications', sa.Column('job_url', sa.String(), nullable=True))
    op.add_column('job_applications', sa.Column('job_url_key', sa.String(), nullable=True))
    op.create_index(
        'ix_job_applications_created_by_job_url_key', 'job_applications', ['created_by', 'job_url_key']
    )


def downgrade() -> None:
    op.drop_index('ix_job_applications_created_by_job_url_key', table_name='job_applications')
    op.drop_column('job_applications', 'job_url_key')
    op.drop_column('job_applications', 'job_url')
