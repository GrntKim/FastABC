from sqlalchemy.orm import Session

from app.courses.models import Course, Exam
from app.accounts.models import User
from fastapi import HTTPException, status


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def own_course(db: Session, user: User, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None or course.owner_id != user.id:
        raise _not_found("course")
    return course


def own_exam(db: Session, user: User, exam_id: int) -> Exam:
    exam = db.get(Exam, exam_id)
    if exam is None or exam.course.owner_id != user.id:
        raise _not_found("exam")
    return exam

