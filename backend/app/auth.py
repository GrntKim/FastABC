from fastapi import HTTPException, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assignment, Course, Exam, Grade, Submission, User


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


def own_assignment(db: Session, user: User, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None or assignment.course.owner_id != user.id:
        raise _not_found("assignment")
    return assignment


def own_submission(db: Session, user: User, submission_id: int) -> Submission:
    submission = db.get(Submission, submission_id)
    if submission is None or submission.assignment.course.owner_id != user.id:
        raise _not_found("submission")
    return submission


def own_grade(db: Session, user: User, grade_id: int) -> Grade:
    owner = db.scalar(
        select(Course.owner_id)
        .join(Assignment, Assignment.course_id == Course.id)
        .join(Submission, Submission.assignment_id == Assignment.id)
        .join(Grade, Grade.submission_id == Submission.id)
        .where(Grade.id == grade_id)
    )
    if owner != user.id:
        raise _not_found("grade")
    return db.get(Grade, grade_id)
