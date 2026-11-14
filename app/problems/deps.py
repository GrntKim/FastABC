from sqlalchemy.orm import Session

from app.accounts.models import User
from app.problems.models import Problem
from app.courses.deps import _not_found


def own_problem(db: Session, user: User, problem_id: int) -> Problem:
    problem = db.get(Problem, problem_id)
    if problem is None or problem.course.owner_id != user.id:
        raise _not_found("problem")
    return problem