from fastapi import APIRouter, Depends, Request, BackgroundTasks
import httpx
from fastapi.responses import RedirectResponse
from sqlalchemy import select, func
from sqlalchemy.orm import Session

from app.accounts.deps import page_user
from app.core.db import get_db, get_session_factory
from app.accounts.models import User
from app.core.templates import templates
from app.grading.models import Grade
from app.grading.engine import Judges, get_judges, run_primary, escalate, has_confirmed_grades
from app.submissions.models import Submission
from app.problems.deps import own_problem
from urllib.parse import quote

router = APIRouter()


def route_counts(db: Session, problem_id: int) -> dict[str, int]:
    return dict(db.execute(
        select(Grade.route, func.count())
        .join(Submission, Grade.submission_id == Submission.id)
        .where(Submission.problem_id == problem_id)
        .group_by(Grade.route)
    ).all())


@router.get("/problems/{problem_id}/progress")
def get_grading_progress(
    request: Request, 
    problem_id: int, 
    db: Session = Depends(get_db), 
    user: User = Depends(page_user)):

    problem = own_problem(db, user, problem_id)
    counts = route_counts(db, problem.id)

    return templates.TemplateResponse(
        request, "grading/_progress.html", 
        {"problem": problem, "counts": counts})


@router.post("/problems/{problem_id}/grade")
def start_grading(
    problem_id: int, 
    background_tasks: BackgroundTasks, 
    db=Depends(get_db),
    user=Depends(page_user),
    judges: Judges = Depends(get_judges),
    session_factory = Depends(get_session_factory)):

    problem = own_problem(db, user, problem_id)
    if not problem.submissions:
        return RedirectResponse(f"/problems/{problem_id}?error={quote("답안이 없습니다.")}", status_code=303)
    elif has_confirmed_grades(db, problem.id):
        return RedirectResponse(f"/problems/{problem_id}?error={quote("이미 확정한 항목이 있어 다시 채점할 수 없습니다.")}", status_code=303)

    try:
        pending = run_primary(db, problem, judges.primary)
    except httpx.HTTPError:
        db.rollback()
        return RedirectResponse(f"/problems/{problem_id}?error={quote("판단 모델 호출에 실패했습니다.")}", status_code=303)

    if pending: 
        background_tasks.add_task(escalate, session_factory, problem.id, judges.secondary)

    return RedirectResponse(f"/problems/{problem.id}", status_code=303)
    

