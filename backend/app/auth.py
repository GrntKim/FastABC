from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Assignment, Course, Grade, Submission, User
from app.courses.deps import _not_found


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
