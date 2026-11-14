"""add exams

Revision ID: 06202e23c7cd
Revises: 3acdc60c4b88
Create Date: 2026-11-10 09:25:03.478018

"""
from typing import Sequence, Union

import re

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '06202e23c7cd'
down_revision: Union[str, Sequence[str], None] = '3acdc60c4b88'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# "중간고사 2번" -> exam "중간고사", question 2; text without a number becomes the exam name alone
NUMBERED = re.compile(r"^(.*?)\s*(\d+)\s*번?\s*$")


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        "exams",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("course_id", sa.Integer(), sa.ForeignKey("courses.id", ondelete="CASCADE"), nullable=False),
        sa.Column("name", sa.String(length=100), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.UniqueConstraint("course_id", "name"),
    )
    op.create_index("ix_exams_course_id", "exams", ["course_id"])
    op.create_table(
        "imported_parts",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("exam_id", sa.Integer(), sa.ForeignKey("exams.id", ondelete="CASCADE"), nullable=False),
        sa.Column("title", sa.String(length=100), nullable=False),
        sa.Column("max_points", sa.Float(), nullable=False),
        sa.Column("source_filename", sa.String(length=255), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_imported_parts_exam_id", "imported_parts", ["exam_id"])
    op.create_table(
        "imported_scores",
        sa.Column("id", sa.Integer(), primary_key=True),
        sa.Column("part_id", sa.Integer(), sa.ForeignKey("imported_parts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("student_ref", sa.String(length=100), nullable=False),
        sa.Column("student_name", sa.String(length=100), nullable=True),
        sa.Column("points", sa.Float(), nullable=False),
        sa.UniqueConstraint("part_id", "student_ref"),
    )
    op.add_column("assignments", sa.Column("exam_id", sa.Integer(), nullable=True))
    op.add_column("assignments", sa.Column("number", sa.Integer(), nullable=True))
    op.create_foreign_key("assignments_exam_id_fkey", "assignments", "exams", ["exam_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_assignments_exam_id", "assignments", ["exam_id"])

    conn = op.get_bind()
    exams: dict[tuple[int, str], int] = {}
    rows = conn.execute(sa.text("SELECT id, course_id, assessment FROM assignments WHERE assessment IS NOT NULL")).all()
    for aid, course_id, assessment in rows:
        m = NUMBERED.match(assessment.strip())
        name, number = (m.group(1).strip(), int(m.group(2))) if m else (assessment.strip(), None)
        if not name:  # "2번" alone names no exam
            continue
        if (course_id, name) not in exams:
            exams[course_id, name] = conn.execute(
                sa.text("INSERT INTO exams (course_id, name) VALUES (:c, :n) RETURNING id"), {"c": course_id, "n": name}
            ).scalar_one()
        conn.execute(
            sa.text("UPDATE assignments SET exam_id = :e, number = :n WHERE id = :a"),
            {"e": exams[course_id, name], "n": number, "a": aid},
        )
    op.drop_column("assignments", "assessment")


def downgrade() -> None:
    """Downgrade schema."""
    op.add_column("assignments", sa.Column("assessment", sa.String(length=100), nullable=True))
    op.execute(
        "UPDATE assignments a SET assessment = e.name || COALESCE(' ' || a.number || '번', '') FROM exams e WHERE a.exam_id = e.id"
    )
    op.drop_index("ix_assignments_exam_id", table_name="assignments")
    op.drop_constraint("assignments_exam_id_fkey", "assignments", type_="foreignkey")
    op.drop_column("assignments", "number")
    op.drop_column("assignments", "exam_id")
    op.drop_table("imported_scores")
    op.drop_index("ix_imported_parts_exam_id", table_name="imported_parts")
    op.drop_table("imported_parts")
    op.drop_index("ix_exams_course_id", table_name="exams")
    op.drop_table("exams")
