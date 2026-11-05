"""rename judgment sources to primary and secondary

Revision ID: 0b671762cebc
Revises: 0ad594202989
Create Date: 2026-11-05 10:27:31.125142

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0b671762cebc'
down_revision: Union[str, Sequence[str], None] = '0ad594202989'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Vendor-neutral role names: the concrete model is recorded in judgments.model
RENAMES = {"jev": "primary", "gemini": "secondary"}


def upgrade() -> None:
    """Upgrade schema."""
    for old, new in RENAMES.items():
        op.execute(sa.text("UPDATE judgments SET source = :new WHERE source = :old").bindparams(old=old, new=new))


def downgrade() -> None:
    """Downgrade schema."""
    for old, new in RENAMES.items():
        op.execute(sa.text("UPDATE judgments SET source = :old WHERE source = :new").bindparams(old=old, new=new))
