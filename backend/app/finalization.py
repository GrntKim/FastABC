"""Grade finalization: the grader's sign-off, a hashed snapshot of the final grades, and the lock it puts on them."""

import hashlib
import json
from typing import Any

from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assignment, Decision, Finalization, Grade, ItemKind, Submission
from app.scoring import max_total, total


def latest(db: Session, assignment_id: int) -> Finalization | None:
    return db.scalar(
        select(Finalization).where(Finalization.assignment_id == assignment_id).order_by(Finalization.version.desc()).limit(1)
    )


def is_locked(db: Session, assignment_id: int) -> bool:
    f = latest(db, assignment_id)
    return f is not None and f.reopened_at is None


def ensure_unlocked(db: Session, assignment_id: int) -> None:
    """Every change to grades or answers goes through this while the grades are signed off."""
    if is_locked(db, assignment_id):
        raise HTTPException(status.HTTP_409_CONFLICT, "grades are finalized: reopen them to make changes")


def snapshot(db: Session, assignment: Assignment) -> tuple[dict[str, Any], dict[str, int]]:
    """Final points and decisions per student, and decision counts. Raises 409 while any cell is undecided."""
    items = [i for i in assignment.items if i.kind != ItemKind.GATE]
    grades = {
        (g.submission_id, g.rubric_item_id): g
        for g in db.scalars(
            select(Grade).join(Submission, Grade.submission_id == Submission.id).where(Submission.assignment_id == assignment.id)
        )
    }
    if not grades or any(g.decision is None for g in grades.values()):
        raise HTTPException(status.HTTP_409_CONFLICT, "every cell must be decided before finalizing")

    students = []
    for s in sorted(assignment.submissions, key=lambda s: s.label):
        cells = {i.key: grades[s.id, i.id] for i in items if (s.id, i.id) in grades}  # none if the answer was unreadable
        students.append(
            {
                "student_ref": s.student_ref,
                "label": s.label,
                "points": {k: g.final_points for k, g in cells.items()},
                "decisions": {k: g.decision for k, g in cells.items()},
                "total": total([g.final_points for g in cells.values()]) if cells else None,
            }
        )
    counts = {d.value: sum(g.decision == d for g in grades.values()) for d in Decision}
    snap = {
        "assignment_id": assignment.id,
        "items": [{"key": i.key, "label": i.label, "kind": i.kind} for i in items],
        "max_points": max_total(assignment.items),
        "students": students,
    }
    return snap, counts


def digest(snap: dict[str, Any]) -> str:
    canonical = json.dumps(snap, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()
