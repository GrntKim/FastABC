import csv
import io

from app.models import Assignment
from tests.test_assignments import make_body
from tests.test_grading import grading  # noqa: F401  (fixture)
from tests.test_review import graded  # noqa: F401  (fixture)


def new_exam(client, course_id: int, name: str = "중간고사") -> int:
    return client.post(f"/courses/{course_id}/exams", json={"name": name}).json()["id"]


def import_csv(client, exam_id: int, text: str, title: str = "객관식", max_points: float = 20):
    files = {"file": ("mc.csv", text.encode(), "text/csv")}
    return client.post(f"/exams/{exam_id}/imports", files=files, data={"title": title, "max_points": max_points})


def test_exams_group_questions(client, course_id):
    exam_id = new_exam(client, course_id)
    assert client.post(f"/courses/{course_id}/exams", json={"name": " 중간고사 "}).status_code == 409
    a = client.post("/assignments", json=make_body(course_id) | {"exam_id": exam_id, "number": 1}).json()
    assert (a["exam_id"], a["number"], a["assessment"]) == (exam_id, 1, "중간고사 1번")

    course = client.get(f"/courses/{course_id}").json()
    assert [e["name"] for e in course["exams"]] == ["중간고사"]

    # an exam of another course cannot hold this course's question
    other = client.post("/courses", json={"department": "d", "term": "2026-2", "name": "n", "section": "01"}).json()["id"]
    other_exam = new_exam(client, other)
    assert client.post("/assignments", json=make_body(course_id) | {"exam_id": other_exam}).status_code == 422

    # deleting the exam keeps its questions in the course
    assert client.delete(f"/exams/{exam_id}").status_code == 204
    assert client.get(f"/assignments/{a['id']}").json()["assessment"] is None


def test_results_add_up_per_student(client, db, graded, course_id):  # noqa: F811
    aid, cells = graded["aid"], graded["cells"]
    exam_id = new_exam(client, course_id)
    db.get(Assignment, aid).exam_id = exam_id  # graded questions cannot be edited through the API
    db.get(Assignment, aid).number = 1
    db.commit()

    r = client.get(f"/exams/{exam_id}/results").json()
    assert [c["kind"] for c in r["columns"]] == ["question"] and r["columns"][0]["stage"] == "review"
    assert [s["student_ref"] for s in r["students"]] == ["20230000", "20230001"]
    assert all(s["total"] is None for s in r["students"])  # nothing decided yet
    assert r["finalized"] is False

    for (answer, _), cell in cells.items():
        if answer == "a":
            client.patch(f"/grades/{cell['grade_id']}", json={"action": "set", "points": 0})
    # multiple choice graded elsewhere, with one student who wrote no essay answer
    assert import_csv(client, exam_id, "학번,이름,점수\n20230000,김민수,15\n20239999,박지훈,10\n").status_code == 201

    r = client.get(f"/exams/{exam_id}/results").json()
    assert [c["title"] for c in r["columns"]] == [r["columns"][0]["title"], "객관식"]
    a, b, absent = r["students"]
    assert a["total"] == 15 and [c["points"] for c in a["cells"]] == [0, 15]
    assert b["total"] is None and b["cells"][1] == {"points": None, "submitted": False, "submission_id": None}
    assert absent["student_name"] == "박지훈" and absent["cells"][0]["submitted"] is False and absent["total"] == 10
    assert r["max_points"] == r["columns"][0]["max_points"] + 20

    rows = list(csv.reader(io.StringIO(client.get(f"/exams/{exam_id}/export.csv").text.lstrip("﻿"))))
    assert rows[0][0:2] == ["student_id", "name"] and rows[0][-2:] == ["객관식", "total"]
    assert rows[3] == ["20239999", "박지훈", "-", "10.0", "10.0"]


def test_import_checks(client, course_id):
    exam_id = new_exam(client, course_id)
    assert import_csv(client, exam_id, "학번,점수\n1,21\n").status_code == 400  # over the maximum
    assert import_csv(client, exam_id, "학번,이름\n1,김\n").status_code == 400  # no points column
    assert import_csv(client, exam_id, "학번,점수\n1,x\n").status_code == 400
    assert import_csv(client, exam_id, "학번,점수\n1,3\n1,4\n").status_code == 400  # duplicate id
    part = import_csv(client, exam_id, "student_id,score\n1,3\n").json()
    assert client.delete(f"/imports/{part['id']}").status_code == 204
    assert client.get(f"/exams/{exam_id}/results").json()["columns"] == []


def test_others_cannot_see_exams(client, stranger, course_id):
    exam_id = new_exam(client, course_id)
    part = import_csv(client, exam_id, "학번,점수\n1,3\n").json()
    assert stranger.post(f"/courses/{course_id}/exams", json={"name": "x"}).status_code == 404
    for path in (f"/exams/{exam_id}/results", f"/exams/{exam_id}/export.csv"):
        assert stranger.get(path).status_code == 404
    assert stranger.delete(f"/imports/{part['id']}").status_code == 404
    assert stranger.delete(f"/exams/{exam_id}").status_code == 404


def exam_csv(client, exam_id: int, text: str):
    return client.post(f"/exams/{exam_id}/submissions/csv", files={"file": ("exam.csv", text.encode(), "text/csv")})


def test_whole_exam_csv_goes_to_each_question(client, course_id):
    exam_id = new_exam(client, course_id)
    q1, q2 = (client.post("/assignments", json=make_body(course_id) | {"exam_id": exam_id, "number": n}).json()["id"] for n in (1, 2))
    sheet = '학번,이름,1번,문항 2,메모\n2024001,김민수,"첫 답, 쉼표 포함",둘째 답,x\n2024002,이서연,,둘째 답 2,y\n'
    r = exam_csv(client, exam_id, sheet)
    assert r.status_code == 201, r.text
    body = r.json()
    assert [(q["assignment_id"], q["created"]) for q in body["questions"]] == [(q1, 1), (q2, 2)]
    assert (body["skipped_existing"], body["locked"], body["ignored_columns"]) == (0, [], ["메모"])
    first = client.get(f"/assignments/{q1}/submissions").json()
    assert [(s["student_ref"], s["student_name"], s["clean_text"]) for s in first] == [("2024001", "김민수", "첫 답, 쉼표 포함")]

    # sent again with one more student: only the new answers go in
    again = exam_csv(client, exam_id, sheet + "2024003,박지호,셋째,\n").json()
    assert [q["created"] for q in again["questions"]] == [1, 0] and again["skipped_existing"] == 3

    # the results point at each answer, to open it for grading
    results = client.get(f"/exams/{exam_id}/results").json()
    kim = next(s for s in results["students"] if s["student_ref"] == "2024001")
    assert kim["cells"][0]["submission_id"] == first[0]["id"]


def test_whole_exam_csv_checks(client, stranger, course_id):
    exam_id = new_exam(client, course_id)
    client.post("/assignments", json=make_body(course_id) | {"exam_id": exam_id, "number": 1})
    assert exam_csv(client, exam_id, "이름,1번\n김,답\n").status_code == 400  # no 학번
    assert exam_csv(client, exam_id, "학번,5번\n1,답\n").status_code == 400  # no question of this exam
    assert exam_csv(client, exam_id, "학번,1번\n1,답\n1,답\n").status_code == 400  # same student twice
    assert exam_csv(stranger, exam_id, "학번,1번\n1,답\n").status_code == 404
