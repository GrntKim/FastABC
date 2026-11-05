"""Grading run: primary judge synchronously, escalations in the background.

Cells (submission x rubric item) the primary judge is sure about get their route right away;
the rest stay `pending` until the secondary judge has answered.
"""

import logging
from collections.abc import Callable
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.judges.base import Judge, Judgment, Questions
from app.judges.gemini import GeminiJudge
from app.judges.jev import JevJudge
from app.judges.routing import Route, needs_escalation, route
from app.models import Assignment, ExtractionStatus, Grade, GradeRoute, JudgeSource, JudgmentRecord, RubricItem, Submission
from app.scoring import item_points

logger = logging.getLogger(__name__)


@dataclass
class Judges:
    primary: Judge
    secondary: Judge


@lru_cache
def get_judges() -> Judges:
    """FastAPI dependency. Overridden in tests so no external API is called."""
    return Judges(JevJudge(), GeminiJudge())


def questions_for(items: list[RubricItem]) -> Questions:
    questions = {}
    for item in items:
        q = {"type": item.type, "instructions": item.instructions}
        if item.criteria is not None:
            q["criteria"] = item.criteria
        questions[item.key] = q
    return questions


def _record(submission: Submission, item: RubricItem, j: Judgment, source: JudgeSource, judge: Judge) -> JudgmentRecord:
    latency = getattr(judge, "last_latency", None)
    return JudgmentRecord(
        submission_id=submission.id,
        rubric_item_id=item.id,
        source=source,
        model=getattr(judge, "model", type(judge).__name__),
        pred=j.pred,
        conf=j.conf,
        raw=j.raw,
        evidence=j.evidence,
        reasoning=j.reasoning,
        skipped=j.skipped,
        latency_ms=round(latency * 1000) if latency is not None else None,
    )


def has_confirmed_grades(db: Session, assignment_id: int) -> bool:
    return db.scalar(
        select(Grade.id)
        .join(Submission, Grade.submission_id == Submission.id)
        .where(Submission.assignment_id == assignment_id, Grade.decision.is_not(None))
        .limit(1)
    ) is not None


def run_primary(db: Session, assignment: Assignment, judge: Judge) -> int:
    """Re-grade every submission with the primary judge. Returns the number of pending cells."""
    submission_ids = select(Submission.id).where(Submission.assignment_id == assignment.id)
    db.execute(delete(JudgmentRecord).where(JudgmentRecord.submission_id.in_(submission_ids)))
    db.execute(delete(Grade).where(Grade.submission_id.in_(submission_ids)))

    items = {item.key: item for item in assignment.items}
    questions = questions_for(assignment.items)
    pending = 0
    for submission in assignment.submissions:
        if submission.extraction_status == ExtractionStatus.FAILED:
            continue
        judgments = judge.evaluate(assignment.problem, submission.clean_text, questions)
        for j in judgments:
            item = items[j.question_id]
            db.add(_record(submission, item, j, JudgeSource.JEV, judge))
            if j.skipped:
                grade = Grade(route=GradeRoute.SKIP, recommended_points=item_points(item, None, gate_passed=False))
            elif needs_escalation(j):
                grade = Grade(route=GradeRoute.PENDING)
                pending += 1
            else:
                grade = Grade(route=GradeRoute.AUTO, recommended_pred=j.pred, recommended_points=item_points(item, j.pred))
            grade.submission_id, grade.rubric_item_id = submission.id, item.id
            db.add(grade)
    db.commit()
    return pending


def escalate(session_factory: Callable[[], Session], assignment_id: int, judge: Judge) -> None:
    """Background task: re-judge pending cells, one secondary call per submission."""
    with session_factory() as db:
        assignment = db.get(Assignment, assignment_id)
        items = {item.id: item for item in assignment.items}
        questions = questions_for(assignment.items)
        for submission in assignment.submissions:
            pending = db.scalars(
                select(Grade).where(Grade.submission_id == submission.id, Grade.route == GradeRoute.PENDING)
            ).all()
            if not pending:
                continue
            primary = {
                r.rubric_item_id: r
                for r in db.scalars(
                    select(JudgmentRecord).where(
                        JudgmentRecord.submission_id == submission.id, JudgmentRecord.source == JudgeSource.JEV
                    )
                )
            }
            escalated = {items[g.rubric_item_id].key: questions[items[g.rubric_item_id].key] for g in pending}
            try:
                second = judge.evaluate(assignment.problem, submission.clean_text, escalated)
            except Exception:
                logger.exception("secondary judge failed for submission %s", submission.id)
                second = []
            by_key = {j.question_id: j for j in second}

            for grade in pending:
                item = items[grade.rubric_item_id]
                p = primary[item.id]
                first = Judgment(item.key, item.type, p.pred, conf=p.conf, raw=p.raw, skipped=p.skipped)
                (rec,) = route([first], second)
                if (s := by_key.get(item.key)) is not None:
                    db.add(_record(submission, item, s, JudgeSource.GEMINI, judge))
                if rec.route == Route.LLM:
                    grade.route = GradeRoute.LLM
                    grade.recommended_pred = rec.pred
                    grade.recommended_points = item_points(item, rec.pred)
                else:
                    grade.route = GradeRoute.HUMAN
            db.commit()  # per submission, so status polling sees progress
