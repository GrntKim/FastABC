from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models import Problem, Course, Grade, Submission, User
from app.courses.deps import _not_found


def own_submission(db: Session, user: User, submission_id: int) -> Submission:
    submission = db.get(Submission, submission_id)
    if submission is None or submission.problem.course.owner_id != user.id:
        raise _not_found("submission")
    return submission



