"""add student names

Revision ID: 3acdc60c4b88
Revises: c01bf7c255ec
Create Date: 2026-11-10 08:36:39.441813

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '3acdc60c4b88'
down_revision: Union[str, Sequence[str], None] = 'c01bf7c255ec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Shown to the grader (who may hide it); judges still only see clean_text. Earlier uploads stay without names.
def upgrade() -> None:
    """Upgrade schema."""
    op.add_column("submissions", sa.Column("student_name", sa.String(length=100), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column("submissions", "student_name")
