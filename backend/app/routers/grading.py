"""Start a grading run and poll its progress."""

import logging
from collections.abc import Callable

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.db import get_db, get_session_factory
from app.grading import Judges, escalate, get_judges, has_confirmed_grades, run_primary
from app.models import Assignment, Grade, GradeRoute, Submission
from app.schemas import GradingStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assignments/{assignment_id}", tags=["grading"])


def _get(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "assignment not found")
    return assignment


def _status(db: Session, assignment_id: int) -> GradingStatus:
    counts = dict(db.execute(
        select(Grade.route, func.count())
        .join(Submission, Grade.submission_id == Submission.id)
        .where(Submission.assignment_id == assignment_id)
        .group_by(Grade.route)
    ).all())
    pending = counts.get(GradeRoute.PENDING, 0)
    return GradingStatus(total=sum(counts.values()), pending=pending, done=pending == 0, routes=counts)


@router.post("/grade", status_code=status.HTTP_202_ACCEPTED)
def start_grading(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    judges: Judges = Depends(get_judges),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
) -> GradingStatus:
    """(Re-)grade every submission. Primary judgments return now; escalations finish in the background."""
    assignment = _get(db, assignment_id)
    if not assignment.submissions:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no submissions to grade")
    if has_confirmed_grades(db, assignment_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "some grades are already confirmed")

    try:
        pending = run_primary(db, assignment, judges.primary)
    except httpx.HTTPError as e:
        db.rollback()
        logger.exception("primary judge failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"primary judge failed: {e}") from e
    if pending:
        background_tasks.add_task(escalate, session_factory, assignment_id, judges.secondary)
    return _status(db, assignment_id)


@router.get("/grading")
def grading_status(assignment_id: int, db: Session = Depends(get_db)) -> GradingStatus:
    _get(db, assignment_id)
    return _status(db, assignment_id)
