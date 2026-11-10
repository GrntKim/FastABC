"""Start a grading run and poll its progress."""

import logging
from collections.abc import Callable

import httpx
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.auth import current_user, own_assignment
from app.db import get_db, get_session_factory
from app.finalization import ensure_unlocked
from app.grading import (
    Judges,
    escalate,
    get_judges,
    has_confirmed_grades,
    run_primary,
    ungraded,
)
from app.models import Assignment, Grade, GradeRoute, Submission, User
from app.schemas import GradingStatus

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/assignments/{assignment_id}", tags=["grading"])


def _status(db: Session, assignment_id: int) -> GradingStatus:
    counts = dict(db.execute(
        select(Grade.route, func.count())
        .join(Submission, Grade.submission_id == Submission.id)
        .where(Submission.assignment_id == assignment_id)
        .group_by(Grade.route)
    ).all())
    pending = counts.get(GradeRoute.PENDING, 0)
    new = len(ungraded(db, db.get(Assignment, assignment_id)))
    return GradingStatus(total=sum(counts.values()), pending=pending, done=pending == 0, routes=counts, ungraded=new)


@router.post("/grade", status_code=status.HTTP_202_ACCEPTED)
def start_grading(
    assignment_id: int,
    background_tasks: BackgroundTasks,
    only_new: bool = False,
    db: Session = Depends(get_db),
    judges: Judges = Depends(get_judges),
    session_factory: Callable[[], Session] = Depends(get_session_factory),
    user: User = Depends(current_user),
) -> GradingStatus:
    """(Re-)grade every submission, or with `only_new` just the answers added since: confirmed grades stay.
    Primary judgments return now; escalations finish in the background."""
    assignment = own_assignment(db, user, assignment_id)
    if not assignment.submissions:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "no submissions to grade")
    if only_new:
        ensure_unlocked(db, assignment_id)
        if not ungraded(db, assignment):
            raise HTTPException(status.HTTP_400_BAD_REQUEST, "no new submissions to grade")
    elif has_confirmed_grades(db, assignment_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "some grades are already confirmed")

    try:
        pending = run_primary(db, assignment, judges.primary, only_new=only_new)
    except httpx.HTTPError as e:
        db.rollback()
        logger.exception("primary judge failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"primary judge failed: {e}") from e
    if pending:
        background_tasks.add_task(escalate, session_factory, assignment_id, judges.secondary)
    return _status(db, assignment_id)


@router.get("/grading")
def grading_status(assignment_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> GradingStatus:
    own_assignment(db, user, assignment_id)
    return _status(db, assignment_id)
