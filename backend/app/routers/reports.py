"""Grading reports for students: for each answer, every rubric item with the points the grader confirmed,
and the answer's own words behind them where a judge reached the same points.

The report states what the grader signed off, not what the AI thought: AI reasoning is never included,
and a quote is shown only when the judge that found it agrees with the confirmed points. Only for
signed-off questions, like a grade that is posted before students see it.
"""

import logging
from concurrent.futures import ThreadPoolExecutor, as_completed

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, own_assignment
from app.db import get_db
from app.finalization import latest
from app.grading.engine import SECONDARY_PARALLEL, Judges, get_judges, judgment_record, questions_for
from app.models import (
    Assignment,
    Decision,
    Grade,
    GradeRoute,
    ItemKind,
    JudgeSource,
    JudgmentRecord,
    RubricItem,
    Submission,
    User,
)
from app.schemas import AssignmentReport, EvidenceOut, FinalizationOut, ReportItem, StudentReport
from app.scoring import item_points, max_total, total

logger = logging.getLogger(__name__)

router = APIRouter(tags=["reports"])

# whose quotes to show, in order: the display-only lookup, then the LLM re-judgment, then the first judgment
QUOTE_SOURCES = (JudgeSource.EVIDENCE, JudgeSource.SECONDARY, JudgeSource.PRIMARY)


def _signed_off(db: Session, assignment: Assignment):
    f = latest(db, assignment.id)
    if f is None or f.reopened_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "성적을 확정한 문항만 근거표를 만듭니다")
    return f


def _submissions(db: Session, assignment: Assignment, student_ref: str | None) -> list[Submission]:
    query = select(Submission).where(Submission.assignment_id == assignment.id).order_by(Submission.student_ref)
    if student_ref is not None:
        query = query.where(Submission.student_ref == student_ref)
    return list(db.scalars(query))


def _earned(grade: Grade) -> bool:
    """Points given or taken: the cells a student would ask "why?" about, and the only ones quoted."""
    return grade.final_points is not None and grade.final_points != 0


@router.get("/assignments/{assignment_id}/report")
def report(
    assignment_id: int, student_ref: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> AssignmentReport:
    """Every answer (or one student's) of a signed-off question, item by item, for the student to read."""
    assignment = own_assignment(db, user, assignment_id)
    finalization = _signed_off(db, assignment)
    submissions = _submissions(db, assignment, student_ref)
    items = {i.id: i for i in assignment.items if i.kind != ItemKind.GATE}
    ids = [s.id for s in submissions]
    grades = db.scalars(select(Grade).where(Grade.submission_id.in_(ids))).all()
    records = {
        (r.submission_id, r.rubric_item_id, r.source): r
        for r in db.scalars(select(JudgmentRecord).where(JudgmentRecord.submission_id.in_(ids)))
    }

    def quotes(grade: Grade) -> list[str]:
        if not _earned(grade):
            return []
        item = items[grade.rubric_item_id]
        for source in QUOTE_SOURCES:
            r = records.get((grade.submission_id, item.id, source))
            if r and r.evidence and item_points(item, r.pred) == grade.final_points:
                return list(r.evidence)
        return []

    by_submission: dict[int, list[Grade]] = {}
    for g in grades:
        if g.rubric_item_id in items:
            by_submission.setdefault(g.submission_id, []).append(g)
    students = []
    for s in submissions:
        cells = sorted(by_submission.get(s.id, []), key=lambda g: items[g.rubric_item_id].position)
        students.append(
            StudentReport(
                submission_id=s.id,
                student_ref=s.student_ref,
                student_name=s.student_name,
                answer=s.clean_text,
                off_topic=bool(cells) and all(g.route == GradeRoute.SKIP for g in cells),
                total=total([g.final_points for g in cells]) if cells else None,
                items=[
                    ReportItem(
                        rubric_item_id=g.rubric_item_id,
                        points=g.final_points,
                        by_grader=g.decision != Decision.ACCEPTED,
                        quotes=quotes(g),
                    )
                    for g in cells
                ],
            )
        )
    return AssignmentReport(
        finalization=FinalizationOut.model_validate(finalization),
        max_points=max_total(assignment.items),
        students=students,
    )


def _missing_evidence(db: Session, submission: Submission) -> list[RubricItem]:
    """Items that gave or took points but have no LLM output yet: the ones a report could quote but cannot."""
    with_llm = select(JudgmentRecord.rubric_item_id).where(
        JudgmentRecord.submission_id == submission.id,
        JudgmentRecord.source.in_([JudgeSource.SECONDARY, JudgeSource.EVIDENCE]),
    )
    return list(db.scalars(
        select(RubricItem)
        .join(Grade, Grade.rubric_item_id == RubricItem.id)
        .where(
            Grade.submission_id == submission.id,
            Grade.route.in_([GradeRoute.AUTO, GradeRoute.LLM, GradeRoute.HUMAN]),
            Grade.final_points.is_not(None),
            Grade.final_points != 0,
            RubricItem.kind != ItemKind.GATE,
            RubricItem.id.not_in(with_llm),
        )
    ))


@router.post("/assignments/{assignment_id}/report/evidence")
def fill_evidence(
    assignment_id: int,
    student_ref: str | None = None,
    db: Session = Depends(get_db),
    judges: Judges = Depends(get_judges),
    user: User = Depends(current_user),
) -> EvidenceOut:
    """Look up quotes for the answers no grader opened (bulk-confirmed ones), before printing reports.

    Display only, like the lookup when a grader opens an answer: grades and the signed-off record stay as
    they are. A few answers at a time; an answer whose lookup fails is printed without quotes."""
    assignment = own_assignment(db, user, assignment_id)
    _signed_off(db, assignment)
    work = [(s, items) for s in _submissions(db, assignment, student_ref) if (items := _missing_evidence(db, s))]
    if not work:
        return EvidenceOut(requested=0)

    judge, problem = judges.evidence_judge, assignment.problem
    with ThreadPoolExecutor(max_workers=SECONDARY_PARALLEL) as pool:
        # only plain values cross threads; the session stays on this one
        futures = {
            pool.submit(judge.evaluate, problem, s.clean_text, questions_for(items)): (s, items) for s, items in work
        }
        for future in as_completed(futures):
            submission, items = futures[future]
            try:
                found = future.result()
            except Exception:
                logger.exception("evidence lookup failed for submission %s", submission.id)
                continue
            by_key = {item.key: item for item in items}
            for j in found:
                if j.question_id in by_key:
                    db.add(judgment_record(submission, by_key[j.question_id], j, JudgeSource.EVIDENCE, judge))
    db.commit()
    return EvidenceOut(requested=sum(len(items) for _, items in work))
