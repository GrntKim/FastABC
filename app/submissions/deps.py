from sqlalchemy.orm import Session
from app.submissions.models import Submission
from app.accounts.models import User
from app.courses.deps import _not_found


def own_submission(db: Session, user: User, submission_id: int) -> Submission:
    submission = db.get(Submission, submission_id)
    if submission is None or submission.problem.course.owner_id != user.id:
        raise _not_found("submission")
    return submission