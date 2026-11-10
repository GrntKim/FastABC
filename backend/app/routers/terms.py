"""A grader's academic calendar per term: when midterm and final grades are due.

The due dates are a soft line. Signing off after one is allowed once the grader says so, and the
sign-off is recorded as late.
"""

from datetime import date, datetime
from zoneinfo import ZoneInfo

from fastapi import APIRouter, Depends, Path
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user
from app.db import get_db
from app.models import Assignment, TermSchedule, User
from app.schemas import TERM_PATTERN, TermScheduleIn, TermScheduleOut

router = APIRouter(prefix="/terms", tags=["terms"])

CAMPUS_TZ = ZoneInfo("Asia/Seoul")  # due dates are campus calendar days


def today() -> date:
    return datetime.now(CAMPUS_TZ).date()


def is_midterm(exam_name: str | None) -> bool:
    """중간고사, 중간시험, 중간고사(이론)…: the presets and how graders write them."""
    return exam_name is not None and "중간" in exam_name


def period(exam_name: str | None) -> str:
    """Which part of the term an exam belongs to: midterm, final, or anything else (quizzes, homework)."""
    if is_midterm(exam_name):
        return "midterm"
    return "final" if exam_name is not None and "기말" in exam_name else "other"


def _row(db: Session, user: User, term: str) -> TermSchedule | None:
    return db.scalar(select(TermSchedule).where(TermSchedule.owner_id == user.id, TermSchedule.term == term))


def grades_due(db: Session, user: User, assignment: Assignment) -> tuple[str, date] | None:
    """Which due date this question's grades fall under, and the date: the midterm one for a midterm
    question, the final one for everything else. None when that date is not set: a midterm question
    never borrows the final date, so what the screen shows is what is checked."""
    row = _row(db, user, assignment.course.term)
    if row is None:
        return None
    if is_midterm(assignment.exam and assignment.exam.name):
        return ("중간고사", row.midterm_due) if row.midterm_due is not None else None
    return ("기말", row.final_due) if row.final_due is not None else None


def _out(term: str, row: TermSchedule | None) -> TermScheduleOut:
    if row is None:
        return TermScheduleOut(term=term)
    return TermScheduleOut(term=term, midterm_due=row.midterm_due, final_due=row.final_due)


@router.get("/{term}")
def get_schedule(
    term: str = Path(pattern=TERM_PATTERN), db: Session = Depends(get_db), user: User = Depends(current_user)
) -> TermScheduleOut:
    return _out(term, _row(db, user, term))


@router.put("/{term}")
def set_schedule(
    body: TermScheduleIn,
    term: str = Path(pattern=TERM_PATTERN),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> TermScheduleOut:
    """Both dates at once; leaving both empty clears the term."""
    row = _row(db, user, term)
    if body.midterm_due is None and body.final_due is None:
        if row is not None:
            db.delete(row)
        row = None
    else:
        if row is None:
            row = TermSchedule(owner_id=user.id, term=term)
            db.add(row)
        row.midterm_due, row.final_due = body.midterm_due, body.final_due
    db.commit()
    return _out(term, row)
