"""add users and course owners

Revision ID: c01bf7c255ec
Revises: cd39bd687620
Create Date: 2026-11-09 17:30:08.606887

Existing courses go to a demo grader (demo@fastabc.kr / demo1234), the account scripts/seed_demo.py also uses.
Sign-offs made before login keep their typed name and get no signer id.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from argon2 import PasswordHasher


# revision identifiers, used by Alembic.
revision: str = 'c01bf7c255ec'
down_revision: Union[str, Sequence[str], None] = 'cd39bd687620'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


DEMO_EMAIL, DEMO_NAME, DEMO_PASSWORD = "demo@fastabc.kr", "김조교", "demo1234"


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('users',
    sa.Column('id', sa.Integer(), nullable=False),
    sa.Column('email', sa.String(length=254), nullable=False),
    sa.Column('name', sa.String(length=100), nullable=False),
    sa.Column('password_hash', sa.String(length=200), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('email')
    )
    op.create_table('sessions',
    sa.Column('token_hash', sa.String(length=64), nullable=False),
    sa.Column('user_id', sa.Integer(), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=False),
    sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('token_hash')
    )
    op.create_index(op.f('ix_sessions_user_id'), 'sessions', ['user_id'], unique=False)

    # existing courses move to the demo grader, then the column becomes required
    op.add_column('courses', sa.Column('owner_id', sa.Integer(), nullable=True))
    conn = op.get_bind()
    if conn.scalar(sa.text("SELECT EXISTS (SELECT 1 FROM courses)")):
        owner = conn.scalar(
            sa.text("INSERT INTO users (email, name, password_hash) VALUES (:email, :name, :hash) RETURNING id"),
            {"email": DEMO_EMAIL, "name": DEMO_NAME, "hash": PasswordHasher().hash(DEMO_PASSWORD)},
        )
        conn.execute(sa.text("UPDATE courses SET owner_id = :owner"), {"owner": owner})
    op.alter_column('courses', 'owner_id', nullable=False)

    # course names are unique per grader now
    op.drop_constraint('courses_department_term_name_section_key', 'courses', type_='unique')
    op.create_index(op.f('ix_courses_owner_id'), 'courses', ['owner_id'], unique=False)
    op.create_unique_constraint(
        'courses_owner_id_department_term_name_section_key', 'courses', ['owner_id', 'department', 'term', 'name', 'section']
    )
    op.create_foreign_key('courses_owner_id_fkey', 'courses', 'users', ['owner_id'], ['id'], ondelete='CASCADE')
    op.add_column('finalizations', sa.Column('finalized_by_id', sa.Integer(), nullable=True))
    op.create_foreign_key(
        'finalizations_finalized_by_id_fkey', 'finalizations', 'users', ['finalized_by_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    """Downgrade schema. Fails if two graders have a course with the same name."""
    op.drop_constraint('finalizations_finalized_by_id_fkey', 'finalizations', type_='foreignkey')
    op.drop_column('finalizations', 'finalized_by_id')
    op.drop_constraint('courses_owner_id_fkey', 'courses', type_='foreignkey')
    op.drop_constraint('courses_owner_id_department_term_name_section_key', 'courses', type_='unique')
    op.drop_index(op.f('ix_courses_owner_id'), table_name='courses')
    op.create_unique_constraint('courses_department_term_name_section_key', 'courses', ['department', 'term', 'name', 'section'])
    op.drop_column('courses', 'owner_id')
    op.drop_index(op.f('ix_sessions_user_id'), table_name='sessions')
    op.drop_table('sessions')
    op.drop_table('users')
