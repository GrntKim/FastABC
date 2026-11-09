"""Sign off an assignment's final grades, and reopen them for a revision."""

from datetime import UTC, datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, own_assignment
from app.db import get_db
from app.finalization import digest, is_locked, latest, snapshot
from app.models import Finalization, GradeRoute, User
from app.routers.grading import _status
from app.schemas import FinalizationOut, FinalizeIn, ReopenIn

router = APIRouter(prefix="/assignments/{assignment_id}", tags=["finalizations"])


@router.get("/finalizations")
def list_finalizations(
    assignment_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[FinalizationOut]:
    """Every version, newest first."""
    own_assignment(db, user, assignment_id)
    rows = db.scalars(
        select(Finalization).where(Finalization.assignment_id == assignment_id).order_by(Finalization.version.desc())
    )
    return [FinalizationOut.model_validate(f) for f in rows]


@router.post("/finalizations", status_code=status.HTTP_201_CREATED)
def finalize(
    assignment_id: int, body: FinalizeIn, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> FinalizationOut:
    """Signed off by the logged-in grader; `body.confirmed` is their statement of responsibility."""
    assignment = own_assignment(db, user, assignment_id)
    if is_locked(db, assignment_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "grades are already finalized")
    if _status(db, assignment_id).routes.get(GradeRoute.PENDING):
        raise HTTPException(status.HTTP_409_CONFLICT, "LLM re-judgment is still running")
    snap, counts = snapshot(db, assignment)
    previous = latest(db, assignment_id)
    f = Finalization(
        assignment_id=assignment_id,
        version=previous.version + 1 if previous else 1,
        finalized_by=user.name,
        finalized_by_id=user.id,
        counts=counts,
        snapshot=snap,
        snapshot_hash=digest(snap),
    )
    db.add(f)
    db.commit()
    return FinalizationOut.model_validate(f)


@router.post("/reopen")
def reopen(
    assignment_id: int, body: ReopenIn, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> FinalizationOut:
    """Unlock the grades for a revision. The signed-off version stays; finalizing again adds the next one."""
    own_assignment(db, user, assignment_id)
    f = latest(db, assignment_id)
    if f is None or f.reopened_at is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "grades are not finalized")
    f.reopened_at, f.reopen_reason = datetime.now(UTC), body.reason
    db.commit()
    return FinalizationOut.model_validate(f)
