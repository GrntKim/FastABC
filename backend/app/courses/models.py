from app.core.db import Base
from sqlalchemy.orm import Mapped, mapped_column, relationship
from sqlalchemy import DateTime, ForeignKey, String, func, UniqueConstraint
from datetime import datetime


class Course(Base):
    __tablename__ = "courses"
    __table_args__ = (UniqueConstraint("owner_id", "department", "term", "name", "section"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    owner_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    department: Mapped[str] = mapped_column(String(100))  # e.g. "컴퓨터공학과"
    term: Mapped[str] = mapped_column(String(20))  # e.g. "2026-2"
    name: Mapped[str] = mapped_column(String(200))
    section: Mapped[str] = mapped_column(String(20))  # e.g. "02"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assignments: Mapped[list["Assignment"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", passive_deletes=True, order_by="Assignment.created_at"
    )
    exams: Mapped[list["Exam"]] = relationship(
        back_populates="course", cascade="all, delete-orphan", passive_deletes=True, order_by="Exam.created_at"
    )


class Exam(Base):
    __tablename__ = "exams"
    __table_args__ = (UniqueConstraint("course_id", "name"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"), index=True)
    name: Mapped[str] = mapped_column(String(100))  # e.g. "중간고사"
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped[Course] = relationship(back_populates="exams")
    assignments: Mapped[list["Assignment"]] = relationship(back_populates="exam", order_by="Assignment.number")
    imports: Mapped[list["ImportedPart"]] = relationship(
        back_populates="exam", cascade="all, delete-orphan", passive_deletes=True, order_by="ImportedPart.created_at"
    )
