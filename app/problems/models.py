from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.courses.models import Course, Exam

class Problem(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    exam_id: Mapped[int | None] = mapped_column(ForeignKey("exams.id", ondelete="SET NULL"), index=True)
    number: Mapped[int | None]  # question number within the exam, e.g. 2 for "2번"
    title: Mapped[str] = mapped_column(String(200))
    text: Mapped[str] = mapped_column("problem", Text)  # the problem as students see it
    judge_model: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped[Course] = relationship(back_populates="problems")
    exam: Mapped[Exam | None] = relationship(back_populates="problems")
    criteria: Mapped[list["Criterion"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan", passive_deletes=True, order_by="Criterion.position"
    )
    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def label(self) -> str | None:
        """How graders name the question, e.g. "중간고사 2번"."""
        if self.exam is None:
            return None
        return f"{self.exam.name} {self.number}번" if self.number is not None else self.exam.name


class Criterion(Base):
    __tablename__ = "rubric_items"
    __table_args__ = (UniqueConstraint("assignment_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    problem_id: Mapped[int] = mapped_column("assignment_id", ForeignKey("assignments.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(100))  # judge question id
    label: Mapped[str | None] = mapped_column(String(100))  # display name for graders; key is shown when empty
    position: Mapped[int]
    type: Mapped[str] = mapped_column(String(16))  # ItemType
    instructions: Mapped[str] = mapped_column(Text)
    descriptions: Mapped[Any] = mapped_column("criteria", JSONB)  # judge question format: noul {true, false} / score [..] / choice {name: desc}
    kind: Mapped[str] = mapped_column(String(16))  # ItemKind
    points: Mapped[float | None] = mapped_column(Float)  # noul credit or deduction
    points_map: Mapped[dict[str, float] | None] = mapped_column(JSONB)  # score level / choice name -> points

    problem: Mapped[Problem] = relationship(back_populates="criteria")

