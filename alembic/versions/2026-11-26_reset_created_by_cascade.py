"""password_reset_tokens.created_by ON DELETE CASCADE

A deleted admin's links must die with the account. With SET NULL they became created_by NULL,
which is how a CLI link looks, and a CLI link may reset an admin account. Kept as its own revision
because the previous one may already be applied.

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
    _recreate("CASCADE")


def downgrade() -> None:
    _recreate("SET NULL")
