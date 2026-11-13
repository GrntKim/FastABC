from datetime import datetime
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.courses.models import Course, Exam

class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    exam_id: Mapped[int | None] = mapped_column(ForeignKey("exams.id", ondelete="SET NULL"), index=True)
    number: Mapped[int | None]  # question number within the exam, e.g. 2 for "2번"
    title: Mapped[str] = mapped_column(String(200))
    problem: Mapped[str] = mapped_column(Text)
    judge_model: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped[Course] = relationship(back_populates="assignments")
    exam: Mapped[Exam | None] = relationship(back_populates="assignments")
    items: Mapped[list["RubricItem"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", passive_deletes=True, order_by="RubricItem.position"
    )
    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", passive_deletes=True
    )

    @property
    def assessment(self) -> str | None:
        """How graders name the question, e.g. "중간고사 2번"."""
        if self.exam is None:
            return None
        return f"{self.exam.name} {self.number}번" if self.number is not None else self.exam.name


class RubricItem(Base):
    __tablename__ = "rubric_items"
    __table_args__ = (UniqueConstraint("assignment_id", "key"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"))
    key: Mapped[str] = mapped_column(String(100))  # judge question id
    label: Mapped[str | None] = mapped_column(String(100))  # display name for graders; key is shown when empty
    position: Mapped[int]
    type: Mapped[str] = mapped_column(String(16))  # ItemType
    instructions: Mapped[str] = mapped_column(Text)
    criteria: Mapped[Any] = mapped_column(JSONB)  # judge question format: noul {true, false} / score [..] / choice {name: desc}
    kind: Mapped[str] = mapped_column(String(16))  # ItemKind
    points: Mapped[float | None] = mapped_column(Float)  # noul credit or deduction
    points_map: Mapped[dict[str, float] | None] = mapped_column(JSONB)  # score level / choice name -> points

    assignment: Mapped[Assignment] = relationship(back_populates="items")

