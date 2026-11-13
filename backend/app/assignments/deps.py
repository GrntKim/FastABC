from sqlalchemy.orm import Session

from app.accounts.models import User
from app.assignments.models import Assignment
from app.courses.deps import _not_found


def own_assignment(db: Session, user: User, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None or assignment.course.owner_id != user.id:
        raise _not_found("assignment")
    return assignment