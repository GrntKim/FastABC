"""Grader review: inspect cells, confirm points, results and CSV export.

Recommendations are never copied into final_points unless the grader accepts them
(CLAUDE.md design principle 5). Bulk accept is limited to confident cells.
"""

import csv
import io
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.grading import Judges, get_judges, judgment_record, questions_for
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
)
from app.schemas import BulkAcceptOut, BulkClearOut, CellOut, EvidenceOut, GradeDecisionIn, JudgeView, SubmissionResult
from app.scoring import max_total, point_range, total

logger = logging.getLogger(__name__)

router = APIRouter(tags=["review"])

CONFIDENT_ROUTES = (GradeRoute.AUTO, GradeRoute.SKIP)


def _get_assignment(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "assignment not found")
    return assignment


def _grades_query(assignment_id: int):
    return (
        select(Grade, Submission, RubricItem)
        .join(Submission, Grade.submission_id == Submission.id)
        .join(RubricItem, Grade.rubric_item_id == RubricItem.id)
        .where(Submission.assignment_id == assignment_id)
    )


@router.get("/assignments/{assignment_id}/cells")
def list_cells(
    assignment_id: int,
    item_id: int | None = None,
    submission_id: int | None = None,
    db: Session = Depends(get_db),
) -> list[CellOut]:
    """Cells ordered by rubric item, then submission label. Filter by item (column view) or submission (row view)."""
    _get_assignment(db, assignment_id)
    query = _grades_query(assignment_id).order_by(RubricItem.position, Submission.label)
    if item_id is not None:
        query = query.where(Grade.rubric_item_id == item_id)
    if submission_id is not None:
        query = query.where(Grade.submission_id == submission_id)
    rows = db.execute(query).all()

    records = db.scalars(
        select(JudgmentRecord).where(JudgmentRecord.submission_id.in_({s.id for _, s, _ in rows}))
    )
    by_cell = {(r.submission_id, r.rubric_item_id, r.source): r for r in records}

    def view(s: Submission, i: RubricItem, source: JudgeSource) -> JudgeView | None:
        r = by_cell.get((s.id, i.id, source))
        return JudgeView.model_validate(r) if r else None

    return [
        CellOut(
            grade_id=g.id,
            submission_id=s.id,
            label=s.label,
            answer=s.clean_text,
            rubric_item_id=i.id,
            item_key=i.key,
            route=g.route,
            sampled=g.sampled,
            recommended_pred=g.recommended_pred,
            recommended_points=g.recommended_points,
            final_points=g.final_points,
            decision=g.decision,
            decided_at=g.decided_at,
            primary=view(s, i, JudgeSource.PRIMARY),
            secondary=view(s, i, JudgeSource.SECONDARY),
            evidence=view(s, i, JudgeSource.EVIDENCE),
        )
        for g, s, i in rows
    ]


@router.patch("/grades/{grade_id}")
def decide(grade_id: int, body: GradeDecisionIn, db: Session = Depends(get_db)) -> CellOut:
    grade = db.get(Grade, grade_id)
    if grade is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "grade not found")
    if grade.route == GradeRoute.PENDING:
        raise HTTPException(status.HTTP_409_CONFLICT, "LLM re-judgment is still running")
    item = db.get(RubricItem, grade.rubric_item_id)

    if body.action == "clear":
        grade.final_points, grade.decision, grade.decided_at = None, None, None
    else:
        if body.action == "accept":
            if grade.recommended_points is None:
                raise HTTPException(status.HTTP_409_CONFLICT, "no recommendation to accept")
            points = grade.recommended_points
        else:
            points = body.points
            low, high = point_range(item)
            if not low <= points <= high:
                raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, f"points must be between {low} and {high}")
        if grade.recommended_points is None:
            decision = Decision.MANUAL
        elif points == grade.recommended_points:
            decision = Decision.ACCEPTED
        else:
            decision = Decision.MODIFIED
        grade.final_points, grade.decision, grade.decided_at = points, decision, datetime.now(UTC)
    db.commit()

    (cell,) = list_cells(item.assignment_id, submission_id=grade.submission_id, item_id=item.id, db=db)
    return cell


@router.post("/assignments/{assignment_id}/accept-confident")
def accept_confident(
    assignment_id: int,
    item_id: int | None = None,
    submission_id: int | None = None,
    db: Session = Depends(get_db),
) -> BulkAcceptOut:
    """Accept every undecided auto/skip cell, optionally for one rubric item or one submission.

    Skips llm/human and sampled cells.
    """
    _get_assignment(db, assignment_id)
    query = _grades_query(assignment_id).where(
        Grade.route.in_(CONFIDENT_ROUTES),
        Grade.sampled.is_(False),
        Grade.decision.is_(None),
        Grade.recommended_points.is_not(None),
    )
    if item_id is not None:
        query = query.where(Grade.rubric_item_id == item_id)
    if submission_id is not None:
        query = query.where(Grade.submission_id == submission_id)
    now = datetime.now(UTC)
    grades = [g for g, _, _ in db.execute(query).all()]
    for g in grades:
        g.final_points, g.decision, g.decided_at = g.recommended_points, Decision.ACCEPTED, now
    db.commit()
    return BulkAcceptOut(accepted=len(grades))


@router.post("/assignments/{assignment_id}/clear-decisions")
def clear_decisions(
    assignment_id: int,
    item_id: int | None = None,
    submission_id: int | None = None,
    db: Session = Depends(get_db),
) -> BulkClearOut:
    """Undo every confirmed cell (accepted, modified, or manual), optionally for one rubric item or one submission."""
    _get_assignment(db, assignment_id)
    query = _grades_query(assignment_id).where(Grade.decision.is_not(None))
    if item_id is not None:
        query = query.where(Grade.rubric_item_id == item_id)
    if submission_id is not None:
        query = query.where(Grade.submission_id == submission_id)
    grades = [g for g, _, _ in db.execute(query).all()]
    for g in grades:
        g.final_points, g.decision, g.decided_at = None, None, None
    db.commit()
    return BulkClearOut(cleared=len(grades))


@router.post("/submissions/{submission_id}/evidence")
def find_evidence(
    submission_id: int,
    db: Session = Depends(get_db),
    judges: Judges = Depends(get_judges),
) -> EvidenceOut:
    """Ask the LLM where the answer supports each judgment, for cells that have no LLM output yet.

    Display only: routes and recommendations stay as they are. One call per submission; later calls are no-ops.
    """
    submission = db.get(Submission, submission_id)
    if submission is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "submission not found")
    assignment = submission.assignment
    with_llm = select(JudgmentRecord.rubric_item_id).where(
        JudgmentRecord.submission_id == submission_id,
        JudgmentRecord.source.in_([JudgeSource.SECONDARY, JudgeSource.EVIDENCE]),
    )
    items = db.scalars(
        select(RubricItem)
        .join(Grade, Grade.rubric_item_id == RubricItem.id)
        .where(
            Grade.submission_id == submission_id,
            Grade.route.in_([GradeRoute.AUTO, GradeRoute.LLM, GradeRoute.HUMAN]),
            RubricItem.kind != ItemKind.GATE,
            RubricItem.id.not_in(with_llm),
        )
    ).all()
    if not items:
        return EvidenceOut(requested=0)

    try:
        found = judges.evidence_judge.evaluate(assignment.problem, submission.clean_text, questions_for(items))
    except Exception as e:
        logger.exception("evidence lookup failed for submission %s", submission_id)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "evidence lookup failed") from e
    by_key = {item.key: item for item in items}
    for j in found:
        db.add(judgment_record(submission, by_key[j.question_id], j, JudgeSource.EVIDENCE, judges.evidence_judge))
    db.commit()
    return EvidenceOut(requested=len(items))


def _results(db: Session, assignment: Assignment) -> list[SubmissionResult]:
    points: dict[int, list[float | None]] = {}
    for g, s, _ in db.execute(_grades_query(assignment.id)).all():
        points.setdefault(s.id, []).append(g.final_points)
    max_points = max_total(assignment.items)
    return [
        SubmissionResult(
            submission_id=s.id,
            label=s.label,
            student_ref=s.student_ref,
            decided=sum(p is not None for p in points.get(s.id, [])),
            cells=len(points.get(s.id, [])),
            total=total(points[s.id]) if points.get(s.id) else None,
            max_points=max_points,
        )
        for s in sorted(assignment.submissions, key=lambda s: s.label)
    ]


@router.get("/assignments/{assignment_id}/results")
def results(assignment_id: int, db: Session = Depends(get_db)) -> list[SubmissionResult]:
    return _results(db, _get_assignment(db, assignment_id))


@router.get("/assignments/{assignment_id}/export.csv")
def export_csv(assignment_id: int, db: Session = Depends(get_db)) -> Response:
    """Final points per rubric item and total. Undecided cells are empty."""
    assignment = _get_assignment(db, assignment_id)
    finals = {(g.submission_id, g.rubric_item_id): g.final_points for g, _, _ in db.execute(_grades_query(assignment_id)).all()}
    items = [i for i in assignment.items if i.kind != ItemKind.GATE]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["student_id", "label", *(i.key for i in items), "total"])
    for r in _results(db, assignment):
        cells = [finals.get((r.submission_id, i.id)) for i in items]
        writer.writerow([r.student_ref, r.label, *("" if p is None else p for p in cells), "" if r.total is None else r.total])
    return Response(
        "﻿" + buf.getvalue(),  # BOM so Excel reads UTF-8 Korean
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="assignment_{assignment_id}.csv"'},
    )
