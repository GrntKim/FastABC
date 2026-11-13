from fastapi import APIRouter, Depends, Request, HTTPException, Form
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.accounts.deps import page_user
from app.core.db import get_db
from app.accounts.models import User
from app.core.templates import templates
from app.submissions.models import Submission
from app.problems.deps import own_problem
from app.grading.models import Grade
from app.review.deps import own_grade
from app.problems.models import Criterion
from app.review.logic import decide
from typing import Annotated

router = APIRouter()


def needs_check(g: Grade) -> bool:
    return g.decision is None and (g.route in ("human", "llm") or g.sampled)


@router.get("/problems/{problem_id}/review")
def show_review(problem_id: int, db: Session = Depends(get_db), user: User = Depends(page_user)):
    problem = own_problem(db, user, problem_id)
    subs = sorted(problem.submissions, key=lambda s: s.label)
    if not subs:
        return RedirectResponse(f"/problems/{problem.id}", status_code=303)

    s = next((s for s in subs if any(needs_check(g) for g in s.grades)), subs[0])
    return RedirectResponse(f"/problems/{problem.id}/review/{s.id}", status_code=303)


@router.get("/problems/{problem_id}/review/{submission_id}")
def get_review(request: Request, problem_id: int, submission_id: int, db: Session = Depends(get_db), user: User = Depends(page_user)):
    problem = own_problem(db, user, problem_id)
    submission = db.get(Submission, submission_id)
    if not submission or submission.problem_id != problem.id:
        raise HTTPException(status_code=404)

    subs = sorted(problem.submissions, key=lambda s: s.label)
    students = [(s, sum(needs_check(g) for g in s.grades), all(g.decision for g in s.grades)) for s in subs]
    grades = {g.criterion_id: g for g in submission.grades}
    judgments = {(j.criterion_id, j.source): j for j in submission.judgments}
    rows = [(c, grades[c.id]) for c in problem.criteria if c.id in grades]

    return templates.TemplateResponse(
        request, "review/show.html",
        {"user": user, "problem": problem, "submission": submission, "students": students, "rows": rows, "judgments": judgments}
    )


@router.post("/grades/{grade_id}")
def post_grade(request: Request, grade_id: int, points: Annotated[str, Form()] = "", db: Session = Depends(get_db), user: User = Depends(page_user)):
    grade = own_grade(db, user, grade_id)
    criterion = db.get(Criterion, grade.criterion_id)
    try:
        val = float(points) if points else None
        decide(db, criterion, grade, val)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return templates.TemplateResponse(
        request, "review/_row.html",
        {"c": criterion, "g": grade}
    )