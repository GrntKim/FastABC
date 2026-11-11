"""Grading run: primary judge synchronously, escalations in the background.

Cells (submission x rubric item) the primary judge is sure about get their route right away;
the rest stay `pending` until the secondary judge has answered.
"""

import logging
import random
from collections.abc import Callable
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass
from functools import lru_cache

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.drafting import RubricDrafter
from app.judges.base import Judge, Judgment, Questions
from app.judges.gemini import GeminiJudge, GeminiReader, GeminiRubricDrafter
from app.judges.jev import DEFAULT_MODEL as PRIMARY_MODEL
from app.judges.jev import JevJudge
from app.judges.routing import Route, needs_escalation, route
from app.models import (
    Assignment,
    ExtractionStatus,
    Grade,
    GradeRoute,
    ItemKind,
    JudgeSource,
    JudgmentRecord,
    RubricItem,
    Submission,
)
from app.reading import AnswerReader
from app.scoring import item_points

logger = logging.getLogger(__name__)

# Share of auto cells flagged for a manual look, so graders keep checking the confident ones too
SAMPLE_RATE = 0.1
# Secondary calls at once: each takes seconds, so 40 answers in a row would take minutes
SECONDARY_PARALLEL = 4


@dataclass
class Judges:
    primary: Judge
    secondary: Judge
    # display-only evidence lookup: locating quotes is easier than judging, so a lighter setting is enough
    evidence: Judge | None = None

    @property
    def evidence_judge(self) -> Judge:
        return self.evidence or self.secondary


def make_judges() -> Judges:
    """The only place that picks concrete judges. Fresh instances (they keep per-call usage and latency)."""
    return Judges(JevJudge(model=PRIMARY_MODEL), GeminiJudge(), evidence=GeminiJudge(thinking_level="low"))


@lru_cache
def get_judges() -> Judges:
    """FastAPI dependency: shared judges for the app. Overridden in tests."""
    return make_judges()


@lru_cache
def get_drafter() -> RubricDrafter:
    """FastAPI dependency: the LLM that turns a plain-language rubric into items. Overridden in tests."""
    return GeminiRubricDrafter()


@lru_cache
def get_reader() -> AnswerReader:
    """FastAPI dependency: the LLM that transcribes photos and scans of answers. Overridden in tests."""
    return GeminiReader()


def questions_for(items: list[RubricItem]) -> Questions:
    questions = {}
    for item in items:
        q = {"type": item.type, "instructions": item.instructions}
        if item.criteria is not None:
            q["criteria"] = item.criteria
        questions[item.key] = q
    return questions


def judgment_record(
    submission: Submission, item: RubricItem, j: Judgment, source: JudgeSource, judge: Judge
) -> JudgmentRecord:
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


def ungraded(db: Session, assignment: Assignment) -> list[Submission]:
    """Readable answers with no first judgment yet: added after grading started."""
    judged = select(JudgmentRecord.submission_id).where(JudgmentRecord.source == JudgeSource.PRIMARY)
    # queried, not read from assignment.submissions: that collection may predate an upload in this session
    return list(db.scalars(
        select(Submission)
        .where(
            Submission.assignment_id == assignment.id,
            Submission.id.not_in(judged),
            Submission.extraction_status != ExtractionStatus.FAILED,
        )
        .order_by(Submission.label)
    ))


def run_primary(db: Session, assignment: Assignment, judge: Judge, only_new: bool = False) -> int:
    """Grade with the primary judge: every submission again, or only those not graded yet. Returns pending cells."""
    if only_new:
        targets = ungraded(db, assignment)
    else:
        submission_ids = select(Submission.id).where(Submission.assignment_id == assignment.id)
        db.execute(delete(JudgmentRecord).where(JudgmentRecord.submission_id.in_(submission_ids)))
        db.execute(delete(Grade).where(Grade.submission_id.in_(submission_ids)))
        targets = [s for s in assignment.submissions if s.extraction_status != ExtractionStatus.FAILED]

    items = {item.key: item for item in assignment.items}
    questions = questions_for(assignment.items)
    pending = 0
    rng = random.Random(assignment.id)  # same sample on re-grade
    for submission in targets:
        if only_new:
            rng = random.Random(f"{assignment.id}-{submission.id}")  # an added answer's sample does not shift others
        judgments = judge.evaluate(assignment.problem, submission.clean_text, questions)
        for j in judgments:
            item = items[j.question_id]
            db.add(judgment_record(submission, item, j, JudgeSource.PRIMARY, judge))
            if item.kind == ItemKind.GATE:
                continue  # carries no points: its judgment is kept, but it is not a cell to decide
            if j.skipped:
                grade = Grade(route=GradeRoute.SKIP, recommended_points=item_points(item, None, gate_passed=False))
            elif needs_escalation(j):
                grade = Grade(route=GradeRoute.PENDING)
                pending += 1
            else:
                grade = Grade(
                    route=GradeRoute.AUTO,
                    sampled=rng.random() < SAMPLE_RATE,
                    recommended_pred=j.pred,
                    recommended_points=item_points(item, j.pred),
                )
            grade.submission_id, grade.rubric_item_id = submission.id, item.id
            db.add(grade)
    db.commit()
    return pending


def escalate(session_factory: Callable[[], Session], assignment_id: int, judge: Judge) -> None:
    """Background task: re-judge pending cells, one secondary call per submission.

    The calls run a few at a time (each takes seconds); results are written on this thread, one
    submission per commit as each call returns, so status polling sees progress."""
    with session_factory() as db:
        assignment = db.get(Assignment, assignment_id)
        items = {item.id: item for item in assignment.items}
        questions = questions_for(assignment.items)
        problem = assignment.problem
        # queried rather than assignment.submissions, which may predate an answer added in the same session
        submissions = db.scalars(select(Submission).where(Submission.assignment_id == assignment_id).order_by(Submission.id))
        work: list[tuple[Submission, list[Grade], str, Questions]] = []
        for submission in submissions:
            pending = list(
                db.scalars(select(Grade).where(Grade.submission_id == submission.id, Grade.route == GradeRoute.PENDING))
            )
            if pending:
                escalated = {items[g.rubric_item_id].key: questions[items[g.rubric_item_id].key] for g in pending}
                work.append((submission, pending, submission.clean_text, escalated))
        if not work:
            return

        def ask(text: str, escalated: Questions, submission_id: int) -> list[Judgment]:
            # only plain values cross threads: the session stays on this one
            try:
                return judge.evaluate(problem, text, escalated)
            except Exception:
                logger.exception("secondary judge failed for submission %s", submission_id)
                return []

        with ThreadPoolExecutor(max_workers=SECONDARY_PARALLEL) as pool:
            futures = {pool.submit(ask, text, escalated, sub.id): (sub, pending) for sub, pending, text, escalated in work}
            for future in as_completed(futures):
                submission, pending = futures[future]
                second = future.result()
                by_key = {j.question_id: j for j in second}
                primary = {
                    r.rubric_item_id: r
                    for r in db.scalars(
                        select(JudgmentRecord).where(
                            JudgmentRecord.submission_id == submission.id, JudgmentRecord.source == JudgeSource.PRIMARY
                        )
                    )
                }
                for grade in pending:
                    item = items[grade.rubric_item_id]
                    p = primary[item.id]
                    # pending means the primary judge was not confident
                    first = Judgment(
                        item.key, item.type, p.pred, conf=p.conf, raw=p.raw, skipped=p.skipped, confident=False
                    )
                    (rec,) = route([first], second)
                    if (s := by_key.get(item.key)) is not None:
                        db.add(judgment_record(submission, item, s, JudgeSource.SECONDARY, judge))
                    if rec.route == Route.LLM:
                        grade.route = GradeRoute.LLM
                        grade.recommended_pred = rec.pred
                        grade.recommended_points = item_points(item, rec.pred)
                    else:
                        grade.route = GradeRoute.HUMAN
                db.commit()  # per submission, so status polling sees progress
