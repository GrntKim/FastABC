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

from app.db import Base


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


class JudgeSource(StrEnum):
    PRIMARY = "primary"  # decision model: first judgment with confidence
    SECONDARY = "secondary"  # LLM re-judgment of escalated cells: decides the llm/human route
    EVIDENCE = "evidence"  # LLM asked later only to locate evidence for display; never changes the route


class GradeRoute(StrEnum):
    PENDING = "pending"  # waiting for the LLM re-judgment
    SKIP = "skip"
    AUTO = "auto"
    LLM = "llm"
    HUMAN = "human"


class Decision(StrEnum):
    ACCEPTED = "accepted"
    MODIFIED = "modified"
    MANUAL = "manual"  # no recommendation was shown (human route)


class User(Base):
    """A grader account. Everything a grader makes hangs off their courses."""

    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True)
    email: Mapped[str] = mapped_column(String(254), unique=True)  # stored lowercased: the login id
    name: Mapped[str] = mapped_column(String(100))  # shown on screen and recorded on sign-offs
    password_hash: Mapped[str] = mapped_column(String(200))  # argon2id
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AuthSession(Base):
    """A login. The cookie holds a random token; only its sha256 is stored, so a leaked table cannot log anyone in."""

    __tablename__ = "sessions"

    token_hash: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True))

    user: Mapped[User] = relationship()


class Course(Base):
    """A course section in one term: the grader's top-level grouping. Only its owner sees it."""

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


class Assignment(Base):
    """One question of an assessment, with its rubric."""

    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(primary_key=True)
    course_id: Mapped[int] = mapped_column(ForeignKey("courses.id", ondelete="CASCADE"))
    assessment: Mapped[str | None] = mapped_column(String(100))  # e.g. "중간고사 2번": stands in for an exam grouping
    title: Mapped[str] = mapped_column(String(200))
    problem: Mapped[str] = mapped_column(Text)
    judge_model: Mapped[str] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    course: Mapped[Course] = relationship(back_populates="assignments")
    items: Mapped[list["RubricItem"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", passive_deletes=True, order_by="RubricItem.position"
    )
    submissions: Mapped[list["Submission"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan", passive_deletes=True
    )


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


class Submission(Base):
    __tablename__ = "submissions"
    __table_args__ = (UniqueConstraint("assignment_id", "student_ref"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"))
    student_ref: Mapped[str] = mapped_column(String(100))  # identifying: never sent to external APIs
    student_name: Mapped[str | None] = mapped_column(String(100))  # identifying: shown to the grader only
    label: Mapped[str] = mapped_column(String(20))  # anonymous label, shown when the grader hides names, e.g. "S001"
    source_filename: Mapped[str | None] = mapped_column(String(255))
    raw_text: Mapped[str] = mapped_column(Text)
    clean_text: Mapped[str] = mapped_column(Text)  # identifiers removed: the only text sent to judges
    extraction_status: Mapped[str] = mapped_column(String(16))  # ExtractionStatus
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    assignment: Mapped[Assignment] = relationship(back_populates="submissions")
    judgments: Mapped[list["JudgmentRecord"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)
    grades: Mapped[list["Grade"]] = relationship(cascade="all, delete-orphan", passive_deletes=True)


class JudgmentRecord(Base):
    """Raw output of one judge for one cell (submission x rubric item)."""

    __tablename__ = "judgments"

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"))
    rubric_item_id: Mapped[int] = mapped_column(ForeignKey("rubric_items.id", ondelete="CASCADE"))
    source: Mapped[str] = mapped_column(String(16))  # JudgeSource
    model: Mapped[str] = mapped_column(String(50))
    pred: Mapped[Any] = mapped_column(JSONB, nullable=True)  # bool | int | str | null
    conf: Mapped[float | None] = mapped_column(Float)
    raw: Mapped[Any] = mapped_column(JSONB, nullable=True)
    evidence: Mapped[list[str]] = mapped_column(JSONB, default=list)
    reasoning: Mapped[str | None] = mapped_column(Text)
    skipped: Mapped[bool] = mapped_column(default=False)
    latency_ms: Mapped[int | None]  # per request, shared by every question in it
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class Grade(Base):
    """Recommendation and the grader's final decision for one cell. Overwritten on change."""

    __tablename__ = "grades"
    __table_args__ = (UniqueConstraint("submission_id", "rubric_item_id"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"))
    rubric_item_id: Mapped[int] = mapped_column(ForeignKey("rubric_items.id", ondelete="CASCADE"))
    route: Mapped[str] = mapped_column(String(16))  # GradeRoute
    sampled: Mapped[bool] = mapped_column(default=False, server_default=false())  # random audit of an auto cell
    recommended_pred: Mapped[Any] = mapped_column(JSONB, nullable=True)
    recommended_points: Mapped[float | None] = mapped_column(Float)
    final_points: Mapped[float | None] = mapped_column(Float)
    decision: Mapped[str | None] = mapped_column(String(16))  # Decision
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))


class Finalization(Base):
    """A grader's sign-off on an assignment's final grades. Locks the grades until reopened; reopening and
    finalizing again adds the next version, so earlier versions stay as history."""

    __tablename__ = "finalizations"
    __table_args__ = (UniqueConstraint("assignment_id", "version"),)

    id: Mapped[int] = mapped_column(primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id", ondelete="CASCADE"))
    version: Mapped[int]
    finalized_by: Mapped[str] = mapped_column(String(100))  # the signer's name as it was then
    finalized_by_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"))
    finalized_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    counts: Mapped[dict[str, int]] = mapped_column(JSONB)  # decision -> cells
    snapshot: Mapped[Any] = mapped_column(JSONB)  # final points and decisions per student
    snapshot_hash: Mapped[str] = mapped_column(String(64))  # sha256 of the canonical snapshot JSON
    reopened_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    reopen_reason: Mapped[str | None] = mapped_column(Text)
