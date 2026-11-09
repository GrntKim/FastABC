"""Assignments (one problem each) and their rubric items."""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.db import get_db
from app.grading import PRIMARY_MODEL
from app.models import Assignment, Course, Grade, RubricItem, Submission
from app.progress import Progress, progress
from app.schemas import AssignmentIn, AssignmentOut, AssignmentSummary, CourseRef, ProgressOut, RubricItemOut
from app.scoring import max_total

router = APIRouter(prefix="/assignments", tags=["assignments"])


def _get(db: Session, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "assignment not found")
    return assignment


def summary(assignment: Assignment, p: Progress) -> AssignmentSummary:
    return AssignmentSummary(
        id=assignment.id,
        course_id=assignment.course_id,
        assessment=assignment.assessment,
        title=assignment.title,
        judge_model=assignment.judge_model,
        created_at=assignment.created_at,
        max_points=max_total(assignment.items),
        submission_count=p.submissions,
        progress=ProgressOut(
            stage=p.stage,
            submissions=p.submissions,
            cells=p.cells,
            decided=p.decided,
            pending=p.pending,
            attention=p.attention,
            students_done=p.students_done,
        ),
    )


def _out(db: Session, assignment: Assignment) -> AssignmentOut:
    base = summary(assignment, progress(db, [assignment.id])[assignment.id])
    return AssignmentOut(
        **base.model_dump(),
        course=CourseRef.model_validate(assignment.course),
        problem=assignment.problem,
        items=[RubricItemOut.model_validate(item) for item in assignment.items],
    )


def _check_course(db: Session, course_id: int) -> None:
    if db.get(Course, course_id) is None:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_CONTENT, "course not found")


def _items(body: AssignmentIn) -> list[RubricItem]:
    return [RubricItem(position=i, **item.model_dump(mode="json")) for i, item in enumerate(body.items)]


@router.post("", status_code=status.HTTP_201_CREATED)
def create_assignment(body: AssignmentIn, db: Session = Depends(get_db)) -> AssignmentOut:
    _check_course(db, body.course_id)
    assignment = Assignment(
        course_id=body.course_id,
        assessment=body.assessment,
        title=body.title,
        problem=body.problem,
        judge_model=PRIMARY_MODEL,
        items=_items(body),
    )
    db.add(assignment)
    db.commit()
    return _out(db, assignment)


@router.get("")
def list_assignments(course_id: int | None = None, db: Session = Depends(get_db)) -> list[AssignmentSummary]:
    query = select(Assignment).order_by(Assignment.created_at.desc())
    if course_id is not None:
        query = query.where(Assignment.course_id == course_id)
    assignments = db.scalars(query).all()
    stats = progress(db, [a.id for a in assignments])
    return [summary(a, stats[a.id]) for a in assignments]


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

    _check_course(db, body.course_id)
    assignment.course_id = body.course_id
    assignment.assessment = body.assessment
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
