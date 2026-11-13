from fastapi import APIRouter, Depends, Request, Form
from fastapi.responses import RedirectResponse
from pydantic import ValidationError
from app.judges.base import GATE
from app.problems.models import Problem
from sqlalchemy.orm import Session
from typing import Annotated
import re

from app.core.db import get_db
from app.grading import PRIMARY_MODEL
from app.problems.models import Criterion
from app.accounts.models import User
from app.courses.deps import own_exam
from app.problems.deps import own_problem
from app.core.templates import templates
from app.accounts.deps import page_user
from app.problems.schemas import CriterionIn
from app.scoring import max_total

router = APIRouter()

# 화면에 안 보이고 저장할 때 맨 앞에 붙는 주제 확인 항목 (프로토타입과 같은 문구)
GATE_ROW = CriterionIn(key=GATE, label="주제 관련성", type="noul", kind="gate",
                       instructions="`answer`가 `question`의 주제를 다루려고 시도한다.")

# 채점자가 쓴 "답안"을 판단기가 읽는 `answer` 표기로 (프로토타입 fromPlain과 같은 규칙)
ANSWER_WORD = re.compile(r"(^|[\s(“\"'‘])답안(?=[이가은는을를의에과와도만로으]|[\s.,)”\"'’]|$)")


def _criteria(rows: list[CriterionIn]) -> list[Criterion]:
    return [Criterion(position=i, **row.model_dump(mode="json")) for i, row in enumerate(rows)]


@router.get("/exams/{exam_id}/problems/new")
def new_problem(request: Request, exam_id: int, db: Session = Depends(get_db), user: User = Depends(page_user)):
    exam = own_exam(db, user, exam_id)
    # 이 시험의 다음 문항 번호, 1·2·3번이 있으면 4를 기본값으로 채움
    next_number = max(((p.number or 0) for p in exam.problems), default=0) + 1
    rows = [{} for _ in range(5)]
    return templates.TemplateResponse(
        request, "problems/new.html",
        {"user": user, "exam": exam, "next_number": next_number, "rows": rows, "error": None, "title": "", "text": ""})


def _form(request, user, exam, error, number, title, text, rows):
    # 새 문항 폼. 처음 열 때와 오류로 다시 그릴 때 같이 씀
    return templates.TemplateResponse(
        request, "problems/new.html",
        {"user": user, "exam": exam, "error": error, "next_number": number,
         "title": title, "text": text, "rows": rows},
        status_code=400 if error else 200)


@router.post("/exams/{exam_id}/problems")
def create_problem(request: Request, exam_id: int,
                   number: Annotated[int, Form()], title: Annotated[str, Form()], text: Annotated[str, Form()],
                   label: Annotated[list[str], Form()], kind: Annotated[list[str], Form()],
                   points: Annotated[list[str], Form()], instructions: Annotated[list[str], Form()],
                   db: Session = Depends(get_db), user: User = Depends(page_user)):
    exam = own_exam(db, user, exam_id)
    title, text = title.strip(), text.strip()
    rows = [{"label": l, "kind": k, "points": p, "instructions": i}
            for l, k, p, i in zip(label, kind, points, instructions)]          # 오류 때 그대로 되돌려 줄 값

    def fail(msg):
        return _form(request, user, exam, msg, number, title, text, rows)

    if not title or not text:
        return fail("제목과 문제를 적으세요")

    filled = [r for r in rows if r["label"].strip() or r["instructions"].strip()]   # 빈 줄 건너뜀
    if not filled:
        return fail("채점 항목을 하나 이상 적으세요")
    try:
        criteria_in = [GATE_ROW] + [
            CriterionIn(key=f"item_{n}", label=r["label"].strip() or None, type="noul", kind=r["kind"],
                        instructions=ANSWER_WORD.sub(r"\1`answer`", r["instructions"].strip()),
                        points=float(r["points"]))
            for n, r in enumerate(filled, start=1)]
    except (ValueError, ValidationError):                 # 배점 빈칸·0 이하, 확인할 내용 빈칸 등
        return fail("항목마다 배점(0보다 큰 수)과 AI가 확인할 내용을 적으세요")

    problem = Problem(course_id=exam.course_id, exam_id=exam.id, number=number, title=title, text=text,
                      judge_model=PRIMARY_MODEL, criteria=_criteria(criteria_in))
    db.add(problem)
    db.commit()
    return RedirectResponse(f"/exams/{exam.id}", status_code=303)


@router.get("/problems/{problem_id}")
def show_problem(request: Request, problem_id: int, db: Session = Depends(get_db), user: User = Depends(page_user)):
    problem = own_problem(db, user, problem_id)
    shown = [c for c in problem.criteria if c.kind != "gate"]
    return templates.TemplateResponse(
        request, "problems/show.html", {
            "user": user, "problem": problem, "criteria": shown, "max_points": max_total(problem.criteria)})
