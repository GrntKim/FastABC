"""Courses: the grader's top-level grouping (department / term / course / section)."""

from collections import Counter

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Course
from app.progress import progress
from app.routers.assignments import summary
from app.schemas import CourseIn, CourseOut, CourseSummary

router = APIRouter(prefix="/courses", tags=["courses"])


def _get(db: Session, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "course not found")
    return course


def _check_unique(db: Session, body: CourseIn, exclude_id: int | None = None) -> None:
    clash = db.scalar(
        select(Course.id).where(
            Course.department == body.department,
            Course.term == body.term,
            Course.name == body.name,
            Course.section == body.section,
        )
    )
    if clash is not None and clash != exclude_id:
        raise HTTPException(status.HTTP_409_CONFLICT, "the same course section already exists")


def _outs(db: Session, courses: list[Course]) -> list[CourseOut]:
    stats = progress(db, [a.id for c in courses for a in c.assignments])
    outs = []
    for c in courses:
        assignments = [summary(a, stats[a.id]) for a in c.assignments]
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
            assignments=assignments,
        ))
    return outs


@router.post("", status_code=status.HTTP_201_CREATED)
def create_course(body: CourseIn, db: Session = Depends(get_db)) -> CourseOut:
    _check_unique(db, body)
    course = Course(**body.model_dump())
    db.add(course)
    db.commit()
    return _outs(db, [course])[0]


@router.get("")
def list_courses(term: str | None = None, db: Session = Depends(get_db)) -> list[CourseSummary]:
    """Newest term first, then department, name, section."""
    query = select(Course).order_by(Course.term.desc(), Course.department, Course.name, Course.section)
    if term is not None:
        query = query.where(Course.term == term)
    return [CourseSummary(**c.model_dump(exclude={"assignments"})) for c in _outs(db, list(db.scalars(query)))]


@router.get("/{course_id}")
def get_course(course_id: int, db: Session = Depends(get_db)) -> CourseOut:
    return _outs(db, [_get(db, course_id)])[0]


@router.put("/{course_id}")
def update_course(course_id: int, body: CourseIn, db: Session = Depends(get_db)) -> CourseOut:
    course = _get(db, course_id)
    _check_unique(db, body, exclude_id=course_id)
    for field, value in body.model_dump().items():
        setattr(course, field, value)
    db.commit()
    return _outs(db, [course])[0]


@router.delete("/{course_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_course(course_id: int, db: Session = Depends(get_db)) -> None:
    """Deletes every assignment, answer, and grade in the course (the UI asks first)."""
    db.delete(_get(db, course_id))
    db.commit()
