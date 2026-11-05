"""Assignments (one problem each) and their rubric items."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import exists, func, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.grading import PRIMARY_MODEL
from app.models import Assignment, Grade, RubricItem, Submission
from app.schemas import AssignmentIn, AssignmentOut, AssignmentSummary, RubricItemOut
from app.scoring import max_total

router = APIRouter(prefix="/assignments", tags=["assignments"])


def _get(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "assignment not found")
    return assignment


def _submission_count(db: Session, assignment_id: int) -> int:
    return db.scalar(select(func.count()).where(Submission.assignment_id == assignment_id))


def _out(db: Session, assignment: Assignment) -> AssignmentOut:
    return AssignmentOut(
        id=assignment.id,
        title=assignment.title,
        judge_model=assignment.judge_model,
        created_at=assignment.created_at,
        max_points=max_total(assignment.items),
        submission_count=_submission_count(db, assignment.id),
        problem=assignment.problem,
        items=[RubricItemOut.model_validate(item) for item in assignment.items],
    )


def _items(body: AssignmentIn) -> list[RubricItem]:
    return [RubricItem(position=i, **item.model_dump(mode="json")) for i, item in enumerate(body.items)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_assignment(body: AssignmentIn, db: Session = Depends(get_db)) -> AssignmentOut:
    assignment = Assignment(title=body.title, problem=body.problem, judge_model=PRIMARY_MODEL, items=_items(body))
    db.add(assignment)
    db.commit()
    return _out(db, assignment)


@router.get("")
def list_assignments(db: Session = Depends(get_db)) -> list[AssignmentSummary]:
    assignments = db.scalars(select(Assignment).order_by(Assignment.created_at.desc())).all()
    return [
        AssignmentSummary(
            id=a.id,
            title=a.title,
            judge_model=a.judge_model,
            created_at=a.created_at,
            max_points=max_total(a.items),
            submission_count=_submission_count(db, a.id),
        )
        for a in assignments
    ]


@router.get("/{assignment_id}")
def get_assignment(assignment_id: int, db: Session = Depends(get_db)) -> AssignmentOut:
    return _out(db, _get(db, assignment_id))


@router.put("/{assignment_id}")
def replace_assignment(assignment_id: int, body: AssignmentIn, db: Session = Depends(get_db)) -> AssignmentOut:
    """Replace the problem and the whole rubric. Refused once grading has started."""
    assignment = _get(db, assignment_id)
    graded = db.scalar(
        select(exists().where(Grade.submission_id == Submission.id, Submission.assignment_id == assignment_id))
    )
    if graded:
        raise HTTPException(status.HTTP_409_CONFLICT, "rubric cannot change after grading has started")

    assignment.title = body.title
    assignment.problem = body.problem
    assignment.items.clear()
    db.flush()  # delete old items first: keys are unique per assignment
    assignment.items.extend(_items(body))
    db.commit()
    return _out(db, assignment)


@router.delete("/{assignment_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_assignment(assignment_id: int, db: Session = Depends(get_db)) -> None:
    db.delete(_get(db, assignment_id))
    db.commit()
