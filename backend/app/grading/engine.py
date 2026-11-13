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
    Problem,
    ExtractionStatus,
    Grade,
    GradeRoute,
    ItemKind,
    JudgeSource,
    JudgmentRecord,
    Criterion,
    Submission,
)
from app.reading import AnswerReader
from app.scoring import item_points

logger = logging.getLogger(__name__)

# Share of answers that get one confident item flagged for a manual look, so graders keep checking the
# confident ones too. Per answer rather than per item: per item, about half of all answers carried one.
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


def questions_for(items: list[Criterion]) -> Questions:
    questions = {}
    for item in items:
        q = {"type": item.type, "instructions": item.instructions}
        if item.descriptions is not None:
            q["criteria"] = item.descriptions
        questions[item.key] = q
    return questions


def judgment_record(
    submission: Submission, item: Criterion, j: Judgment, source: JudgeSource, judge: Judge
) -> JudgmentRecord:
    latency = getattr(judge, "last_latency", None)
    return JudgmentRecord(
        submission_id=submission.id,
        criterion_id=item.id,
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


def has_confirmed_grades(db: Session, problem_id: int) -> bool:
    return db.scalar(
        select(Grade.id)
        .join(Submission, Grade.submission_id == Submission.id)
        .where(Submission.problem_id == problem_id, Grade.decision.is_not(None))
        .limit(1)
    ) is not None


def ungraded(db: Session, problem: Problem) -> list[Submission]:
    """Readable answers with no first judgment yet: added after grading started."""
    judged = select(JudgmentRecord.submission_id).where(JudgmentRecord.source == JudgeSource.PRIMARY)
    # queried, not read from problem.submissions: that collection may predate an upload in this session
    return list(db.scalars(
        select(Submission)
        .where(
            Submission.problem_id == problem.id,
            Submission.id.not_in(judged),
            Submission.extraction_status != ExtractionStatus.FAILED,
        )
        .order_by(Submission.label)
    ))


def run_primary(db: Session, problem: Problem, judge: Judge, only_new: bool = False) -> int:
    """Grade with the primary judge: every submission again, or only those not graded yet. Returns pending cells."""
    if only_new:
        targets = ungraded(db, problem)
    else:
        submission_ids = select(Submission.id).where(Submission.problem_id == problem.id)
        db.execute(delete(JudgmentRecord).where(JudgmentRecord.submission_id.in_(submission_ids)))
        db.execute(delete(Grade).where(Grade.submission_id.in_(submission_ids)))
        targets = [s for s in problem.submissions if s.extraction_status != ExtractionStatus.FAILED]

    items = {item.key: item for item in problem.criteria}
    questions = questions_for(problem.criteria)
    pending = 0
    confident: dict[int, list[Grade]] = {}  # submission id -> its auto cells, the ones an audit draws from
    for submission in targets:
        judgments = judge.evaluate(problem.text, submission.clean_text, questions)
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
                    recommended_pred=j.pred,
                    recommended_points=item_points(item, j.pred),
                )
                confident.setdefault(submission.id, []).append(grade)
            grade.submission_id, grade.criterion_id = submission.id, item.id
            db.add(grade)
    # the same draw on a re-grade; answers added later draw among themselves and leave the others' audits alone
    seed = problem.id if not only_new else f"{problem.id}-{min((s.id for s in targets), default=0)}"
    draw_audits(list(confident.values()), random.Random(seed), at_least_one=not only_new)
    db.commit()
    return pending


def draw_audits(answers: list[list[Grade]], rng: random.Random, at_least_one: bool) -> None:
    """Flag one confident cell in about SAMPLE_RATE of the answers (each answer's list of auto cells).
    A fractional count is rounded up by chance, so one added answer is drawn one time in ten; a whole
    grading run audits at least one answer, so even a small class sees the audit at work."""
    if SAMPLE_RATE <= 0 or not answers:
        return
    expected = SAMPLE_RATE * len(answers)
    count = min(len(answers), int(expected) + (rng.random() < expected - int(expected)))
    if at_least_one:
        count = max(count, 1)
    for cells in rng.sample(answers, count):
        rng.choice(cells).sampled = True


def escalate(session_factory: Callable[[], Session], problem_id: int, judge: Judge) -> None:
    """Background task: re-judge pending cells, one secondary call per submission.

    The calls run a few at a time (each takes seconds); results are written on this thread, one
    submission per commit as each call returns, so status polling sees progress."""
    with session_factory() as db:
        problem = db.get(Problem, problem_id)
        items = {item.id: item for item in problem.criteria}
        questions = questions_for(problem.criteria)
        problem_text = problem.text
        # queried rather than problem.submissions, which may predate an answer added in the same session
        submissions = db.scalars(select(Submission).where(Submission.problem_id == problem_id).order_by(Submission.id))
        work: list[tuple[Submission, list[Grade], str, Questions]] = []
        for submission in submissions:
            pending = list(
                db.scalars(select(Grade).where(Grade.submission_id == submission.id, Grade.route == GradeRoute.PENDING))
            )
            if pending:
                escalated = {items[g.criterion_id].key: questions[items[g.criterion_id].key] for g in pending}
                work.append((submission, pending, submission.clean_text, escalated))
        if not work:
            return

        def ask(text: str, escalated: Questions, submission_id: int) -> list[Judgment]:
            # only plain values cross threads: the session stays on this one
            try:
                return judge.evaluate(problem_text, text, escalated)
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
                    r.criterion_id: r
                    for r in db.scalars(
                        select(JudgmentRecord).where(
                            JudgmentRecord.submission_id == submission.id, JudgmentRecord.source == JudgeSource.PRIMARY
                        )
                    )
                }
                for grade in pending:
                    item = items[grade.criterion_id]
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
