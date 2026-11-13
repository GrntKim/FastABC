from sqlalchemy import select
from sqlalchemy.orm import Session
from app.accounts.models import User
from app.courses.models import Course
from app.problems.models import Problem
from app.submissions.models import Submission
from app.grading.models import Grade
from app.courses.deps import _not_found

def own_grade(db: Session, user: User, grade_id: int) -> Grade:
    owner = db.scalar(
        select(Course.owner_id)
        .join(Problem, Problem.course_id == Course.id)
        .join(Submission, Submission.problem_id == Problem.id)
        .join(Grade, Grade.submission_id == Submission.id)
        .where(Grade.id == grade_id)
    )
    if owner != user.id:
        raise _not_found("grade")
    return db.get(Grade, grade_id)