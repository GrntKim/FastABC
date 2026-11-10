"""Load the usage-scenario demo (docs/scenario.md) into the dev DB, graded with the real judges.

    uv run python scripts/seed_demo.py

Course 정보보호개론 (2026-2, 01), exam 중간고사 with two essay questions and imported multiple choice:
- 1번 비밀번호 저장: 12 answers, every cell decided from the grader's own labels in data/eval,
  then signed off, so the course shows a finished question
- 2번 SQL 인젝션: the 40 answers in data/demo/sql_injection.csv, graded and left for review
- 객관식: points from data/demo/midterm_mc.csv, as if exported from the LMS
Question 1 uses the first 12 students of question 2, so the exam results line up by 학번.

Everything belongs to the demo grader 김조교 (demo@fastabc.kr / demo1234), created on the first run.
Synthetic answers only (fine for a free-tier LLM key). Each run creates both questions again.
"""

import csv
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

DATA = Path(__file__).resolve().parents[2] / "data"
COURSE = {"department": "컴퓨터공학과", "term": "2026-2", "name": "정보보호개론", "section": "01"}
GRADER = {"email": "demo@fastabc.kr", "name": "김조교", "password": "demo1234"}
EXAM = "중간고사"


def log_in(client: TestClient) -> None:
    r = client.post("/auth/signup", json=GRADER)
    if r.status_code == 409:  # the account exists: from an earlier run or the users migration
        r = client.post("/auth/login", json={k: GRADER[k] for k in ("email", "password")})
    r.raise_for_status()


def get_course(client: TestClient) -> int:
    r = client.post("/courses", json=COURSE)
    if r.status_code == 409:  # reuse the demo course on later runs
        return next(c["id"] for c in client.get("/courses").json() if all(c[k] == v for k, v in COURSE.items()))
    r.raise_for_status()
    return r.json()["id"]


def get_exam(client: TestClient, course_id: int) -> int:
    r = client.post(f"/courses/{course_id}/exams", json={"name": EXAM})
    if r.status_code == 409:
        return next(e["id"] for e in client.get(f"/courses/{course_id}").json()["exams"] if e["name"] == EXAM)
    r.raise_for_status()
    return r.json()["id"]


def create(client: TestClient, course_id: int, exam_id: int, number: int, question: dict) -> int:
    r = client.post("/assignments", json={
        "course_id": course_id,
        "exam_id": exam_id,
        "number": number,
        "title": question["title"],
        "problem": question["problem"],
        "items": question["items"],
    })
    r.raise_for_status()
    return r.json()["id"]


def upload_and_grade(client: TestClient, aid: int, csv_bytes: bytes) -> None:
    client.post(
        f"/assignments/{aid}/submissions/csv", files={"file": ("answers.csv", csv_bytes, "text/csv")}
    ).raise_for_status()
    # TestClient runs the background escalation before returning
    client.post(f"/assignments/{aid}/grade").raise_for_status()
    print(f"assignment {aid}: {client.get(f'/assignments/{aid}/grading').json()}")


def label_points(item: dict, label: str) -> float:
    if item["type"] == "score":
        return item["points_map"][label]
    if label == "0":
        return 0.0
    return -item["points"] if item["kind"] == "deduction" else item["points"]


def finished_question(client: TestClient, course_id: int, exam_id: int) -> int:
    question = json.loads((DATA / "eval/q1_password_storage/question.json").read_text())
    with open(DATA / "eval/q1_password_storage/answers.csv", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    with open(DATA / "demo/sql_injection.csv", encoding="utf-8-sig") as f:
        students = [(r["학번"].strip(), r["이름"].strip()) for r in csv.DictReader(f)]
    aid = create(client, course_id, exam_id, 1, question)

    # the same students as question 2, so the exam results add up per student
    ids = {sid: row for (sid, _), row in zip(students, rows, strict=False)}
    names = dict(students)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["학번", "이름", "답안"])
    writer.writerows([sid, names[sid], row["answer"]] for sid, row in ids.items())
    upload_and_grade(client, aid, buf.getvalue().encode())

    items = {i["key"]: i for i in question["items"]}
    refs = {s["id"]: s["student_ref"] for s in client.get(f"/assignments/{aid}/submissions").json()}
    for cell in client.get(f"/assignments/{aid}/cells").json():
        label = ids[refs[cell["submission_id"]]][cell["item_key"]]
        points = label_points(items[cell["item_key"]], label)
        client.patch(f"/grades/{cell['grade_id']}", json={"action": "set", "points": points}).raise_for_status()
    r = client.post(f"/assignments/{aid}/finalizations", json={"confirmed": True})
    r.raise_for_status()
    print(f"assignment {aid}: finalized {r.json()['counts']}")
    return aid


def review_question(client: TestClient, course_id: int, exam_id: int) -> int:
    question = json.loads((DATA / "eval/q2_sql_injection/question.json").read_text())
    aid = create(client, course_id, exam_id, 2, question)
    upload_and_grade(client, aid, (DATA / "demo/sql_injection.csv").read_bytes())
    return aid


def import_multiple_choice(client: TestClient, exam_id: int) -> None:
    files = {"file": ("midterm_mc.csv", (DATA / "demo/midterm_mc.csv").read_bytes(), "text/csv")}
    client.post(f"/exams/{exam_id}/imports", files=files, data={"title": "객관식", "max_points": 20}).raise_for_status()


def main() -> None:
    client = TestClient(app)
    log_in(client)
    course_id = get_course(client)
    exam_id = get_exam(client, course_id)
    finished_question(client, course_id, exam_id)
    aid = review_question(client, course_id, exam_id)
    import_multiple_choice(client, exam_id)
    print(f"course: http://localhost:3000/courses/{course_id}")
    print(f"exam:   http://localhost:3000/exams/{exam_id}")
    print(f"review: http://localhost:3000/assignments/{aid}")


if __name__ == "__main__":
    main()
