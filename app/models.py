"""ORM models.

Status-like columns are plain strings validated by the StrEnums below (no native PG enums,
so adding a value does not need a migration).
"""

from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, false, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.accounts.models import User, AuthSession
from app.courses.models import Course, Exam
from app.problems.models import Problem, Criterion
from app.submissions.models import Submission
from app.grading.models import Decision, Grade, GradeRoute, JudgeSource, JudgmentRecord

class ItemType(StrEnum):
    NOUL = "noul"
    SCORE = "score"
    CHOICE = "choice"


class ItemKind(StrEnum):
    GATE = "gate"  # False: every other item scores 0
    CREDIT = "credit"  # noul True: +points / score, choice: points_map[pred]
    DEDUCTION = "deduction"  # noul True: -points


class ExtractionStatus(StrEnum):
    OK = "ok"
    FAILED = "failed"  # grader must paste the text manually
    MANUAL = "manual"




class ImportedPart(Base):
    """Points graded elsewhere (multiple choice from the LMS or an OMR sheet), brought in as one column of an exam."""

    __tablename__ = "imported_parts"

    id: Mapped[int] = mapped_column(primary_key=True)
    exam_id: Mapped[int] = mapped_column(ForeignKey("exams.id", ondelete="CASCADE"), index=True)
    title: Mapped[str] = mapped_column(String(100))  # e.g. "객관식"
    max_points: Mapped[float] = mapped_column(Float)
    source_filename: Mapped[str | None] = mapped_column(String(255))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    exam: Mapped[Exam] = relationship(back_populates="imports")
    scores: Mapped[list["ImportedScore"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)


class ImportedScore(Base):
    __tablename__ = "imported_scores"
    __table_args__ = (UniqueConstraint("part_id", "student_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    part_id: Mapped[int] = mapped_column(ForeignKey("imported_parts.id", ondelete="CASCADE"))
    student_ref: Mapped[str] = mapped_column(String(100))
    student_name: Mapped[str | None] = mapped_column(String(100))
    points: Mapped[float] = mapped_column(Float)






class Finalization(Base):
    """A grader's sign-off on a problem's final grades. Locks the grades until reopened; reopening and
    finalizing again adds the next version, so earlier versions stay as history."""

    __tablename__ = "finalizations"
    __table_args__ = (UniqueConstraint("assignment_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    problem_id: Mapped[int] = mapped_column("assignment_id", ForeignKey("assignments.id", ondelete="CASCADE"))
    version: Mapped[int]
    finalized_by: Mapped[str] = mapped_column(String(100))  # the signer's name as it was then
    finalized_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    finalized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    counts: Mapped[dict[str, int]] = mapped_column(JSONB)  # decision -> cells
    snapshot: Mapped[Any] = mapped_column(JSONB)  # final points and decisions per student
    snapshot_hash: Mapped[str] = mapped_column(String(64))  # sha256 of the canonical snapshot JSON
    late: Mapped[bool] = mapped_column(default=False, server_default=false())  # signed off after the term's grades were due
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reopen_reason: Mapped[str | None] = mapped_column(Text)
