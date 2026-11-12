from fastapi import APIRouter, Depends, Form, Request
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session
from sqlalchemy.exc import IntegrityError

from app.accounts.deps import page_user
from app.courses.deps import own_course
from app.core.db import get_db
from app.courses.models import Course, Exam
from app.accounts.models import User
from app.core.templates import templates
import re
from typing import Annotated

router = APIRouter()


TERM_RE = re.compile(r"^\d{4}-(1|1S|2|2W)$")
SESSIONS = [("1", "1학기"), ("1S", "여름 계절학기"), ("2", "2학기"), ("2W", "겨울 계절학기")]


class CourseExists(Exception):
    pass


def _create_course(db: Session, user: User, department: str, term: str, name: str, section: str) -> Course:
    course = Course(owner_id=user.id, department=department, term=term, name=name, section=section)
    db.add(course)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise CourseExists from None
    return course


def _home(request: Request, db: Session, user: User, error: str | None = None, status_code: int = 200):
    courses = db.scalars(
        select(Course).where(Course.owner_id == user.id)
        .order_by(Course.term.desc(), Course.department, Course.name, Course.section)
    ).all()
    return templates.TemplateResponse(
        request, "courses/index.html",
        {"user": user, "courses": courses, "sessions": SESSIONS, "error": error},
        status_code=status_code
    )


@router.get("/")
def home(request: Request, db: Session = Depends(get_db), user: User = Depends(page_user)):
    return _home(request, db, user)


@router.post("/courses")
def create_course(request: Request,
                  department: Annotated[str, Form()], year: Annotated[int, Form()],
                  session: Annotated[str, Form()], name: Annotated[str, Form()],
                  section: Annotated[str, Form()],
                  db: Session = Depends(get_db), user: User = Depends(page_user)):
    department, name, section = department.strip(), name.strip(), section.strip()
    if section.isdigit():
        section = f"{int(section):02d}"
    term = f"{year}-{session}"
    if not (department and name and section) or not TERM_RE.match(term):
        return _home(request, db, user, "학과·과목명·분반을 채우고 학기를 고르세요", 400)
    try:
        course = _create_course(db, user, department, term, name, section)
    except CourseExists:
        return _home(request, db, user, "같은 학기에 같은 과목·분반이 이미 있습니다", 409)
    return RedirectResponse(f"/courses/{course.id}", status_code=303)


@router.get("/courses/{course_id}")
def show_course(course_id: int, request: Request,
                db: Session = Depends(get_db), user: User = Depends(page_user)):
    course = own_course(db, user, course_id)
    loose = [a for a in course.assignments if a.exam_id is None]      # 시험 밖 문항
    return templates.TemplateResponse(
        request, "courses/show.html", {"user": user, "course": course, "loose": loose})


@router.post("/courses/{course_id}/exams")
def add_exam(course_id: int, name: Annotated[str, Form()],
             db: Session = Depends(get_db), user: User = Depends(page_user)):
    course = own_course(db, user, course_id)

    name = name.strip()
    if not name:
        # 1. name.strip(), 비면 그냥 과목 화면으로 303 (또는 오류 표시)
        return RedirectResponse(f"/courses/{course.id}", status_code=303)

    # 2. Exam(course_id=course.id, name=...) add → commit, IntegrityError면 rollback (같은 이름 시험)
    exam = Exam(course_id=course_id, name=name)
    db.add(exam)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
    # 3. RedirectResponse(f"/courses/{course.id}", 303)
    return RedirectResponse(f"/courses/{course.id}", status_code=303)