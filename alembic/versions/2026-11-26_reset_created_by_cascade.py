"""password_reset_tokens.created_by ON DELETE CASCADE

A deleted admin's links must die with the account. With SET NULL they became created_by NULL,
which is how a CLI link looks, and a CLI link may reset an admin account. Kept as its own revision
because the previous one may already be applied.

Under f3a9c6d41b85 a deleted admin's links became created_by NULL and would pass as CLI links, which
skip the admin rechecks. That revision cannot tell them apart from real CLI links, so upgrade drops
every unused NULL link. CLI links are rare, short-lived and can be re-issued. Used rows are kept.
The DELETE only matters on a database where f3a9c6d41b85 ran without this revision. No such
database has reached Neon (neither revision is deployed). A link removed this way can simply
be re-issued.
Downgrade does not restore the deleted rows; the schema still round-trips.

Revision ID: a7c2e9d05b14
Revises: f3a9c6d41b85
Create Date: 2026-11-26 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "a7c2e9d05b14"
down_revision: Union[str, Sequence[str], None] = "f3a9c6d41b85"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

FK = "fk_password_reset_tokens_created_by"


def _recreate(ondelete: str) -> None:
    op.drop_constraint(FK, "password_reset_tokens", type_="foreignkey")
    op.create_foreign_key(
        FK, "password_reset_tokens", "users", ["created_by"], ["id"], ondelete=ondelete
    )


def upgrade() -> None:
    op.execute("DELETE FROM password_reset_tokens WHERE created_by IS NULL AND used_at IS NULL")
    _recreate("CASCADE")


def downgrade() -> None:
    _recreate("SET NULL")
