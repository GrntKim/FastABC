"""A grader's academic calendar per term: when grades are due.

The due date is a soft line. Signing off after it is allowed once the grader says so, and the
sign-off is recorded as late.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_db
from app.models import TermSchedule, User
from app.schemas import TERM_PATTERN, TermScheduleIn, TermScheduleOut

router = APIRouter(prefix="/terms", tags=["terms"])

CAMPUS_TZ = ZoneInfo("Asia/Seoul")  # due dates are campus calendar days


def today() -> date:
    return datetime.now(CAMPUS_TZ).date()


def grades_due(db: Session, user: User, term: str) -> date | None:
    return db.scalar(select(TermSchedule.grades_due).where(TermSchedule.owner_id == user.id, TermSchedule.term == term))


@router.get("/{term}")
def get_schedule(
    term: str = Path(pattern=TERM_PATTERN), db: Session = Depends(get_db), user: User = Depends(current_user)
) -> TermScheduleOut:
    return TermScheduleOut(term=term, grades_due=grades_due(db, user, term))


@router.put("/{term}")
def set_schedule(
    body: TermScheduleIn,
    term: str = Path(pattern=TERM_PATTERN),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> TermScheduleOut:
    row = db.scalar(select(TermSchedule).where(TermSchedule.owner_id == user.id, TermSchedule.term == term))
    if body.grades_due is None:
        if row is not None:
            db.delete(row)
    elif row is None:
        db.add(TermSchedule(owner_id=user.id, term=term, grades_due=body.grades_due))
    else:
        row.grades_due = body.grades_due
    db.commit()
    return TermScheduleOut(term=term, grades_due=body.grades_due)
