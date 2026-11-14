from datetime import datetime

from sqlalchemy import DateTime, ForeignKey, String, Text, UniqueConstraint, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.core.db import Base
from app.problems.models import Problem

class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    problem_id: Mapped[int] = mapped_column("assignment_id", ForeignKey("assignments.id", ondelete="CASCADE"))
    student_ref: Mapped[str] = mapped_column(String(100))  # identifying: never sent to external APIs
    student_name: Mapped[str | None] = mapped_column(String(100))  # identifying: shown to the grader only
    label: Mapped[str] = mapped_column(String(20))  # anonymous label, shown when the grader hides names, e.g. "S001"
    source_filename: Mapped[str | None] = mapped_column(String(255))
    raw_text: Mapped[str] = mapped_column(Text)
    clean_text: Mapped[str] = mapped_column(Text)  # identifiers removed: the only text sent to judges
    extraction_status: Mapped[str] = mapped_column(String(16))  # ExtractionStatus
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    problem: Mapped[Problem] = relationship(back_populates="submissions")
    judgments: Mapped[list["JudgmentRecord"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)
    grades: Mapped[list["Grade"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)

