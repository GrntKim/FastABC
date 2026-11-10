"""split grade due dates into midterm and final

Revision ID: 1303405b52c7
Revises: a23a1469ab50
Create Date: 2026-11-10 14:53:09.792122

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1303405b52c7'
down_revision: Union[str, Sequence[str], None] = 'a23a1469ab50'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The one date set so far was the end-of-term deadline: it becomes the final one.
def upgrade() -> None:
    """Upgrade schema."""
    op.alter_column("term_schedules", "grades_due", new_column_name="final_due", nullable=True)
    op.add_column("term_schedules", sa.Column("midterm_due", sa.Date(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.execute("DELETE FROM term_schedules WHERE final_due IS NULL")
    op.drop_column("term_schedules", "midterm_due")
    op.alter_column("term_schedules", "final_due", new_column_name="grades_due", nullable=False)
