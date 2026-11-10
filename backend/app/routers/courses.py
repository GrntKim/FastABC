"""Courses: the grader's top-level grouping (department / term / course / section)."""

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import current_user, own_course
from app.db import get_db
from app.models import Course, User
from app.progress import progress
from app.routers.assignments import summary
from app.routers.terms import period
from app.schemas import (
    AssignmentSummary,
    CourseGroup,
    CourseIn,
    CourseOut,
    CourseSummary,
    ExamRef,
)

router = APIRouter(prefix="/courses", tags=["courses"])


def _check_unique(db: Session, user: User, body: CourseIn, exclude_id: int | None = None) -> None:
    clash = db.scalar(
        select(Course.id).where(
            Course.owner_id == user.id,
            Course.department == body.department,
            Course.term == body.term,
            Course.name == body.name,
            Course.section == body.section,
        )
    )
    if clash is not None and clash != exclude_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "the same course section already exists")


def _group(exam_id: int | None, name: str | None, assignments: list[AssignmentSummary]) -> CourseGroup:
    return CourseGroup(
        exam_id=exam_id,
        name=name,
        period=period(name),
        assignment_count=len(assignments),
        attention=sum(a.progress.attention for a in assignments),
        stages=dict(Counter(a.progress.stage for a in assignments)),
    )


def _outs(db: Session, courses: list[Course]) -> list[CourseOut]:
    stats = progress(db, [a.id for c in courses for a in c.assignments])
    outs = []
    for c in courses:
        assignments = [summary(a, stats[a.id]) for a in c.assignments]
        by_exam: dict[int | None, list[AssignmentSummary]] = {}
        for a in assignments:
            by_exam.setdefault(a.exam_id, []).append(a)
        groups = [_group(e.id, e.name, by_exam.get(e.id, [])) for e in c.exams]
        if None in by_exam:
            groups.append(_group(None, None, by_exam[None]))
        outs.append(CourseOut(
            id=c.id,
            department=c.department,
            term=c.term,
            name=c.name,
            section=c.section,
            created_at=c.created_at,
            assignment_count=len(assignments),
            submission_count=sum(a.submission_count for a in assignments),
            attention=sum(a.progress.attention for a in assignments),
            stages=dict(Counter(a.progress.stage for a in assignments)),
            groups=groups,
            assignments=assignments,
            exams=[ExamRef.model_validate(e) for e in c.exams],
        ))
    return outs


@router.post("", status_code=status.HTTP_201_CREATED)
def create_course(body: CourseIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> CourseOut:
    _check_unique(db, user, body)
    course = Course(owner_id=user.id, **body.model_dump())
    db.add(course)
    db.commit()
    return _outs(db, [course])[0]


@router.get("")
def list_courses(
    term: str | None = None, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[CourseSummary]:
    """The user's courses: newest term first, then department, name, section."""
    query = select(Course).where(Course.owner_id == user.id).order_by(Course.term.desc(), Course.department, Course.name, Course.section)
    if term is not None:
        query = query.where(Course.term == term)
    return [CourseSummary(**c.model_dump(exclude={"assignments", "exams"})) for c in _outs(db, list(db.scalars(query)))]


@router.get("/{course_id}")
def get_course(course_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> CourseOut:
    return _outs(db, [own_course(db, user, course_id)])[0]


@router.put("/{course_id}")
def update_course(
    course_id: int, body: CourseIn, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> CourseOut:
    course = own_course(db, user, course_id)
    _check_unique(db, user, body, exclude_id=course_id)
    for field, value in body.model_dump().items():
        setattr(course, field, value)
    db.commit()
    return _outs(db, [course])[0]


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> None:
    """Deletes every assignment, answer, and grade in the course (the UI asks first)."""
    db.delete(own_course(db, user, course_id))
    db.commit()
