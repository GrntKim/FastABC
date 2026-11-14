"""Load the usage-scenario demo into the dev DB, graded with the real judges.

    uv run python scripts/seed_demo.py           # everything graded, ready to look around
    uv run python scripts/seed_demo.py --empty   # questions 1 and 2 without answers, for the video
    uv run python scripts/seed_demo.py --booth   # exam 부스 시연: questions 1-3 without answers

Course 정보보호개론 (2026-2, 01), exam 중간고사 with three essay questions and imported multiple choice:
- 1번 비밀번호 저장: 12 answers, every cell decided from the grader's own labels in data/eval,
  then signed off, so the course shows a finished question
- 2번 SQL 인젝션: the 40 answers in data/demo/sql_injection.csv, graded and left for review
- 3번 대칭키와 공개키 암호: 3번 of data/demo/midterm_answers.csv, graded and left for review
- 객관식: points from data/demo/midterm_mc.csv, as if exported from the LMS
Question 1 uses the first 12 students of question 2, so the exam results line up by 학번.

With --empty, questions 1 and 2 are made with their rubrics but no answers, and 3번 is left for the
video to make. The answers then go in at once through the exam page (data/demo/midterm_answers.csv).

With --booth, only an exam 부스 시연 is added (once) with questions 1-3 and no answers, for the booth: upload
data/demo/booth_answers.csv (15 students) on its page, grade, review, sign off, then clear it with
scripts/booth_reset.py --exam <id> --yes for the next visitors.

Everything belongs to the demo grader 김조교 (demo@fastabc.kr / demo1234), created on the first run.
Writes through the models and the grading functions directly, not through HTTP. Synthetic answers only
(fine for a free-tier LLM key). Each run creates the questions again.
"""

import argparse
import csv
import json
from datetime import UTC, datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

import app.models  # noqa: F401  registers every model
from app.core.db import SessionLocal
from app.core.security import hash_password
from app.finalization import digest, snapshot
from app.grading.engine import PRIMARY_MODEL, escalate, make_judges, run_primary
from app.models import (
    Course,
    Criterion,
    Decision,
    Exam,
    Finalization,
    Grade,
    ImportedPart,
    ImportedScore,
    Problem,
    Submission,
    User,
)
from app.problems.schemas import CriterionIn
from app.submissions.redact import redact

DATA = Path(__file__).resolve().parents[1] / "data"
COURSE = {"department": "컴퓨터공학과", "term": "2026-2", "name": "정보보호개론", "section": "01"}
GRADER = {"email": "demo@fastabc.kr", "name": "김조교", "password": "demo1234"}
EXAM = "중간고사"
BOOTH_EXAM = "부스 시연"
QUESTIONS = ("eval/q1_password_storage/question.json", "eval/q2_sql_injection/question.json", "demo/q3_crypto.json")


def read_csv(path: Path) -> list[dict[str, str]]:
    with open(path, encoding="utf-8-sig", newline="") as f:
        return list(csv.DictReader(f))


def get_grader(db: Session) -> User:
    user = db.scalar(select(User).where(User.email == GRADER["email"]))
    if user is None:
        user = User(email=GRADER["email"], name=GRADER["name"], password_hash=hash_password(GRADER["password"]))
        db.add(user)
        db.commit()
    return user


def get_exam(db: Session, user: User, name: str = EXAM) -> Exam:
    course = db.scalar(select(Course).filter_by(owner_id=user.id, **COURSE))
    if course is None:
        course = Course(owner_id=user.id, **COURSE)
        db.add(course)
    exam = next((e for e in course.exams if e.name == name), None)
    if exam is None:
        exam = Exam(course=course, name=name)
        db.add(exam)
    db.commit()
    return exam


def create(db: Session, exam: Exam, number: int, question: dict) -> Problem:
    """A problem from an eval or demo question file; "criteria" there is what the app calls descriptions."""
    rows = [CriterionIn(**{**i, "descriptions": i.get("criteria")}) for i in question["items"]]
    problem = Problem(
        course_id=exam.course_id,
        exam_id=exam.id,
        number=number,
        title=question["title"],
        text=question["problem"],
        judge_model=PRIMARY_MODEL,
        criteria=[Criterion(position=n, **r.model_dump(mode="json")) for n, r in enumerate(rows)],
    )
    db.add(problem)
    db.commit()
    return problem


def add_answers(db: Session, problem: Problem, answers: list[tuple[str, str, str]], filename: str) -> None:
    """(학번, 이름, 답안) in order; labels S001, S002, … as an upload would give them."""
    for n, (ref, name, text) in enumerate(answers, start=1):
        db.add(Submission(
            problem=problem,
            student_ref=ref,
            student_name=name,
            label=f"S{n:03d}",
            raw_text=text,
            clean_text=redact(text, [ref, name]),
            extraction_status="ok",
            source_filename=filename,
        ))
    db.commit()


def grade(db: Session, problem: Problem) -> None:
    """The same calls the app makes: primary now, then the re-judgment (in the app, a background task)."""
    judges = make_judges()
    pending = run_primary(db, problem, judges.primary)
    if pending:
        escalate(SessionLocal, problem.id, judges.secondary)
    db.expire_all()  # escalate wrote through its own session
    routes: dict[str, int] = {}
    for g in db.scalars(select(Grade).join(Submission).where(Submission.problem_id == problem.id)):
        routes[g.route] = routes.get(g.route, 0) + 1
    print(f"{problem.label}: {len(problem.submissions)} answers graded {routes}")


def label_points(item: Criterion, label: str) -> float:
    if item.type == "score":
        return item.points_map[label]
    if label == "0":
        return 0.0
    return -item.points if item.kind == "deduction" else item.points


def finished_question(db: Session, exam: Exam, user: User) -> None:
    question = json.loads((DATA / "eval/q1_password_storage/question.json").read_text())
    labeled = read_csv(DATA / "eval/q1_password_storage/answers.csv")
    students = read_csv(DATA / "demo/sql_injection.csv")
    problem = create(db, exam, 1, question)

    # the same students as question 2, so the exam results add up per student
    by_ref = {s["학번"].strip(): row for s, row in zip(students, labeled, strict=False)}
    names = {s["학번"].strip(): s["이름"].strip() for s in students}
    add_answers(db, problem, [(ref, names[ref], row["answer"]) for ref, row in by_ref.items()], "answers.csv")
    grade(db, problem)

    # decide every cell from the grader's labels, as if done on the review screen
    items = {c.id: c for c in problem.criteria}
    for s in problem.submissions:
        for g in s.grades:
            item = items[g.criterion_id]
            points = label_points(item, by_ref[s.student_ref][item.key])
            if g.recommended_points is None:
                g.decision = Decision.MANUAL
            elif points == g.recommended_points:
                g.decision = Decision.ACCEPTED
            else:
                g.decision = Decision.MODIFIED
            g.final_points, g.decided_at = points, datetime.now(UTC)
    db.flush()

    snap, counts = snapshot(db, problem)
    db.add(Finalization(
        problem_id=problem.id,
        version=1,
        finalized_by=user.name,
        finalized_by_id=user.id,
        counts=counts,
        snapshot=snap,
        snapshot_hash=digest(snap),
    ))
    db.commit()
    print(f"{problem.label}: signed off {counts}")


def review_question(db: Session, exam: Exam) -> None:
    question = json.loads((DATA / "eval/q2_sql_injection/question.json").read_text())
    problem = create(db, exam, 2, question)
    rows = read_csv(DATA / "demo/sql_injection.csv")
    add_answers(db, problem, [(r["학번"].strip(), r["이름"].strip(), r["답안"]) for r in rows], "sql_injection.csv")
    grade(db, problem)


def crypto_question(db: Session, exam: Exam) -> None:
    question = json.loads((DATA / "demo/q3_crypto.json").read_text())
    problem = create(db, exam, 3, question)
    rows = [r for r in read_csv(DATA / "demo/midterm_answers.csv") if r["3번"].strip()]  # blank: no answer
    add_answers(db, problem, [(r["학번"].strip(), r["이름"].strip(), r["3번"]) for r in rows], "midterm_answers.csv")
    grade(db, problem)


def empty_questions(db: Session, exam: Exam) -> None:
    for number, path in ((1, "eval/q1_password_storage/question.json"), (2, "eval/q2_sql_injection/question.json")):
        problem = create(db, exam, number, json.loads((DATA / path).read_text()))
        print(f"{problem.label}: no answers yet")


def booth_exam(db: Session, user: User) -> Exam:
    """The booth exam with questions 1-3 and no answers; left as it is when it already has them."""
    exam = get_exam(db, user, BOOTH_EXAM)
    if not exam.problems:
        for number, path in enumerate(QUESTIONS, start=1):
            create(db, exam, number, json.loads((DATA / path).read_text()))
        db.refresh(exam)  # problems were added by id, not through exam.problems
    print(f"{exam.name}: problems {[p.number for p in exam.problems]}")
    return exam


def import_multiple_choice(db: Session, exam: Exam) -> None:
    rows = read_csv(DATA / "demo/midterm_mc.csv")
    db.add(ImportedPart(
        exam_id=exam.id,
        title="객관식",
        max_points=20,
        source_filename="midterm_mc.csv",
        scores=[
            ImportedScore(student_ref=r["학번"].strip(), student_name=r["이름"].strip() or None, points=float(r["점수"]))
            for r in rows
        ],
    ))
    db.commit()


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--empty", action="store_true", help="questions 1 and 2 without answers, for the video")
    parser.add_argument("--booth", action="store_true", help="only the booth exam, questions 1-3 without answers")
    args = parser.parse_args()

    with SessionLocal() as db:
        user = get_grader(db)
        if args.booth:
            exam = booth_exam(db, user)
            print(f"exam:   http://localhost:8000/exams/{exam.id}")
            print(f"reset:  uv run python scripts/booth_reset.py --exam {exam.id} --yes")
            return
        exam = get_exam(db, user)
        if args.empty:
            empty_questions(db, exam)
        else:
            finished_question(db, exam, user)
            review_question(db, exam)
            crypto_question(db, exam)
        import_multiple_choice(db, exam)
        print(f"course: http://localhost:8000/courses/{exam.course_id}")
        print(f"exam:   http://localhost:8000/exams/{exam.id}")


if __name__ == "__main__":
    main()
