"""hash_session_tokens

Rename sessions.token to sessions.token_hash. From here on the column holds
the SHA-256 hex digest of the cookie value, never the raw token.

Existing rows are deleted first, in both directions: plaintext tokens cannot
be safely converted in place, and a digest cannot be turned back into the
token. Everyone logs in again once, on upgrade and on downgrade.

Revision ID: 3f1c9a7d2b64
Revises: ca793c851e6f
Create Date: 2026-10-21 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = '3f1c9a7d2b64'
down_revision: Union[str, Sequence[str], None] = 'ca793c851e6f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("DELETE FROM sessions")
    op.alter_column("sessions", "token", new_column_name="token_hash")
    op.execute(
        "ALTER TABLE sessions RENAME CONSTRAINT sessions_token_key TO sessions_token_hash_key"
    )


def downgrade() -> None:
    op.execute("DELETE FROM sessions")
    op.execute(
        "ALTER TABLE sessions RENAME CONSTRAINT sessions_token_hash_key TO sessions_token_key"
    )
    op.alter_column("sessions", "token_hash", new_column_name="token")
