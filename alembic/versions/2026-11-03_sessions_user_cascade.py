"""sessions.user_id ON DELETE CASCADE and index

Account deletion removes a user's sessions in the same statement as the user, so a
concurrent login cannot leave an orphan. The index keeps that cascade (and per-user
session lookups) from scanning sessions.

Revision ID: d4e8a2c61f07
Revises: b7d4a1e93c52
Create Date: 2026-11-03 15:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4e8a2c61f07'
down_revision: Union[str, Sequence[str], None] = 'b7d4a1e93c52'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.drop_constraint('sessions_user_id_fkey', 'sessions', type_='foreignkey')
    op.create_foreign_key(
        'sessions_user_id_fkey', 'sessions', 'users', ['user_id'], ['id'], ondelete='CASCADE'
    )
    op.create_index('ix_sessions_user_id', 'sessions', ['user_id'])


def downgrade() -> None:
    op.drop_index('ix_sessions_user_id', table_name='sessions')
    op.drop_constraint('sessions_user_id_fkey', 'sessions', type_='foreignkey')
    op.create_foreign_key('sessions_user_id_fkey', 'sessions', 'users', ['user_id'], ['id'])
