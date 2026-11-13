from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.grading import PRIMARY_MODEL
from app.problems.models import Criterion
from app.accounts.models import User
from app.courses.deps import own_exam
from app.core.templates import templates
from app.accounts.deps import page_user
from app.problems.schemas import CriterionIn

router = APIRouter()


def _criteria(rows: list[CriterionIn]) -> list[Criterion]:
    return [Criterion(position=i, **row.model_dump(mode="json")) for i, row in enumerate(rows)]


@router.get("/exams/{exam_id}/problems/new")
def new_problem(request: Request, exam_id: int, db: Session = Depends(get_db), user: User = Depends(page_user)):
    exam = own_exam(db, user, exam_id)
    # 이 시험의 다음 문항 번호, 1·2·3번이 있으면 4를 기본값으로 채움
    next_number = max(((p.number or 0) for p in exam.problems), default=0) + 1
    rows = [{} for _ in range(3)]
    return templates.TemplateResponse(
        request, "problems/new.html",
        {"user": user, "exam": exam, "next_number": next_number, "rows": rows, "error": None, "title": "", "text": ""})

# @router.get("/{assignment_id}")
# def get_assignment(assignment_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> AssignmentOut:
#     return _out(db, own_assignment(db, user, assignment_id))

# @router.get("/exams/{exam_id}/questions/new")
# def 