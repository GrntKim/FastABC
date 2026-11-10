from app.models import Assignment, Submission
from tests.test_assignments import make_body
from tests.test_grading import FakePrimary, FakeSecondary, grading  # noqa: F401  (fixture)

COURSE = {"department": "컴퓨터공학과", "term": "2026-2", "name": "자료구조", "section": "02"}


def test_create_and_duplicate(client):
    r = client.post("/courses", json=COURSE)
    assert r.status_code == 201
    assert (r.json()["assignment_count"], r.json()["stages"]) == (0, {})
    assert client.post("/courses", json=COURSE).status_code == 409
    assert client.post("/courses", json=COURSE | {"section": "03"}).status_code == 201


def test_list_order_and_term_filter(client):
    terms = [("2026-1", "운영체제"), ("2026-2", "자료구조"), ("2026-2", "알고리즘"), ("2026-1S", "컴파일러"), ("2026-2W", "보안")]
    for term, name in terms:
        assert client.post("/courses", json=COURSE | {"term": term, "name": name}).status_code == 201
    listed = client.get("/courses").json()
    # newest first, the seasonal sessions in calendar order: 2W after 2, 1S between 1 and 2
    expected = [("2026-2W", "보안"), ("2026-2", "알고리즘"), ("2026-2", "자료구조"), ("2026-1S", "컴파일러"), ("2026-1", "운영체제")]
    assert [(c["term"], c["name"]) for c in listed] == expected
    assert [c["name"] for c in client.get("/courses", params={"term": "2026-1"}).json()] == ["운영체제"]
    assert "assignments" not in listed[0]


def test_term_format(client):
    for bad in ("2026-3", "2026 2학기", "26-1", "2026-S"):
        assert client.post("/courses", json=COURSE | {"term": bad}).status_code == 422, bad


def test_term_schedule(client, stranger):
    empty = {"term": "2026-2", "midterm_due": None, "final_due": None}
    assert client.get("/terms/2026-2").json() == empty
    assert client.put("/terms/2026-2", json={"final_due": "2026-12-24"}).status_code == 200
    both = {"midterm_due": "2026-10-30", "final_due": "2026-12-28"}
    assert client.put("/terms/2026-2", json=both).json() == {"term": "2026-2"} | both
    assert client.get("/terms/2026-2").json() == {"term": "2026-2"} | both
    assert stranger.get("/terms/2026-2").json() == empty  # each grader's own calendar
    client.put("/terms/2026-2", json={"midterm_due": None, "final_due": None})
    assert client.get("/terms/2026-2").json() == empty
    assert client.get("/terms/2026-3").status_code == 422


def test_groups_by_exam_period(client, course_id):
    exams = {n: client.post(f"/courses/{course_id}/exams", json={"name": n}).json()["id"] for n in ("중간고사", "기말고사", "퀴즈 1")}
    client.post("/assignments", json=make_body(course_id) | {"exam_id": exams["중간고사"], "number": 1})
    client.post("/assignments", json=make_body(course_id) | {"exam_id": exams["중간고사"], "number": 2})
    client.post("/assignments", json=make_body(course_id))  # outside any exam
    groups = next(c for c in client.get("/courses").json() if c["id"] == course_id)["groups"]
    assert [(g["name"], g["period"], g["assignment_count"], g["stages"]) for g in groups] == [
        ("중간고사", "midterm", 2, {"setup": 2}),
        ("기말고사", "final", 0, {}),
        ("퀴즈 1", "other", 0, {}),
        (None, "other", 1, {"setup": 1}),
    ]


def test_assignment_belongs_to_course(client, course_id):
    exam_id = client.post(f"/courses/{course_id}/exams", json={"name": "중간고사"}).json()["id"]
    body = make_body(course_id) | {"exam_id": exam_id, "number": 2}
    a = client.post("/assignments", json=body).json()
    assert (a["course"]["id"], a["course"]["name"], a["assessment"]) == (course_id, "딥러닝개론", "중간고사 2번")
    assert a["progress"]["stage"] == "setup"

    assert client.post("/assignments", json=make_body(999999)).status_code == 422
    assert [x["id"] for x in client.get("/assignments", params={"course_id": course_id}).json()] == [a["id"]]
    assert client.get("/assignments", params={"course_id": 999999}).json() == []


def test_progress_through_stages(client, grading):
    primary = FakePrimary({"b": {"accuracy": (2, 0.5)}})  # one cell escalated, the judges agree on level 2
    aid = grading(primary, FakeSecondary({"b": {"accuracy": 2}}), ["a", "b"])
    course_id = client.get(f"/assignments/{aid}").json()["course_id"]

    client.post(f"/assignments/{aid}/grade")
    p = client.get(f"/assignments/{aid}").json()["progress"]
    assert (p["stage"], p["submissions"], p["cells"], p["decided"], p["attention"]) == ("review", 2, 12, 0, 1)
    assert p["students_done"] == 0

    course = client.get(f"/courses/{course_id}").json()
    assert (course["stages"], course["attention"], course["submission_count"]) == ({"review": 1}, 1, 2)

    client.post(f"/assignments/{aid}/accept-confident")
    llm_cell = next(c for c in client.get(f"/assignments/{aid}/cells").json() if c["route"] == "llm")
    client.patch(f"/grades/{llm_cell['grade_id']}", json={"action": "accept"})
    p = client.get(f"/assignments/{aid}").json()["progress"]
    assert (p["stage"], p["decided"], p["attention"], p["students_done"]) == ("done", 12, 0, 2)


def test_update_and_delete_cascade(client, db, course_id):
    r = client.put(f"/courses/{course_id}", json=COURSE)
    assert (r.status_code, r.json()["name"]) == (200, "자료구조")
    other = client.post("/courses", json=COURSE | {"section": "09"}).json()["id"]
    assert client.put(f"/courses/{other}", json=COURSE).status_code == 409  # clashes with the updated one

    aid = client.post("/assignments", json=make_body(course_id)).json()["id"]
    db.add(Submission(
        assignment_id=aid, student_ref="x", label="S001", raw_text="r", clean_text="c", extraction_status="ok"
    ))
    db.flush()
    assert client.delete(f"/courses/{course_id}").status_code == 204
    assert client.get(f"/courses/{course_id}").status_code == 404
    assert db.query(Assignment).filter_by(id=aid).count() == 0
    assert db.query(Submission).count() == 0
