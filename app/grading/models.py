from datetime import datetime
from enum import StrEnum
from typing import Any

from sqlalchemy import DateTime, Float, ForeignKey, String, Text, UniqueConstraint, false, func
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column 
from app.core.db import Base


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


class JudgmentRecord(Base):
    """Raw output of one judge for one cell (submission x rubric item)."""

    __tablename__ = "judgments"

    id: Mapped[int] = mapped_column(primary_key=True)
    submission_id: Mapped[int] = mapped_column(ForeignKey("submissions.id", ondelete="CASCADE"))
    criterion_id: Mapped[int] = mapped_column("rubric_item_id", ForeignKey("rubric_items.id", ondelete="CASCADE"))
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
    criterion_id: Mapped[int] = mapped_column("rubric_item_id", ForeignKey("rubric_items.id", ondelete="CASCADE"))
    route: Mapped[str] = mapped_column(String(16))  # GradeRoute
    sampled: Mapped[bool] = mapped_column(default=False, server_default=false())  # random audit of an auto cell
    recommended_pred: Mapped[Any] = mapped_column(JSONB, nullable=True)
    recommended_points: Mapped[float | None] = mapped_column(Float)
    final_points: Mapped[float | None] = mapped_column(Float)
    decision: Mapped[str | None] = mapped_column(String(16))  # Decision
    decided_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
