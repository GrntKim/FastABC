"""drop gate grades

Revision ID: 62834785186f
Revises: b0b62a8c80e6
Create Date: 2026-11-08 18:33:08.457478

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '62834785186f'
down_revision: Union[str, Sequence[str], None] = 'b0b62a8c80e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Gate items carry no points, so they are no longer cells a grader decides; their judgments stay
def upgrade() -> None:
    """Upgrade schema."""
    op.execute(
        sa.text("DELETE FROM grades WHERE rubric_item_id IN (SELECT id FROM rubric_items WHERE kind = 'gate')")
    )


def downgrade() -> None:
    """Downgrade schema."""
    # Deleted gate cells are not restored; re-grade an assignment to rebuild its cells
    pass
