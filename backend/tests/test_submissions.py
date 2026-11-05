import pytest

from app.models import Grade
from tests.test_assignments import make_body


@pytest.fixture
def assignment_id(client) -> int:
    return client.post("/assignments", json=make_body()).json()["id"]


def upload(client, assignment_id: int, text: str, encoding: str = "utf-8"):
    files = {"file": ("answers.csv", text.encode(encoding), "text/csv")}
    return client.post(f"/assignments/{assignment_id}/submissions/csv", files=files)


CSV = 'student_id,name,answer\n20231234,김민수,"김민수입니다.\n역전파는 연쇄법칙을 쓴다."\n20231235,이서연,오차를 뒤로 보낸다.\n'


def test_upload(client, assignment_id):
    r = upload(client, assignment_id, CSV)
    assert r.status_code == 201
    first, second = r.json()
    assert (first["label"], first["student_ref"]) == ("S001", "20231234")
    assert first["clean_text"] == "[식별 정보]입니다.\n역전파는 연쇄법칙을 쓴다."  # multiline cell kept
    assert second["label"] == "S002"
    assert "name" not in first
    assert client.get(f"/assignments/{assignment_id}").json()["submission_count"] == 2


def test_labels_continue_and_list(client, assignment_id):
    upload(client, assignment_id, CSV)
    r = upload(client, assignment_id, "student_id,answer\n20231236,답\n")
    assert r.json()[0]["label"] == "S003"
    assert [s["label"] for s in client.get(f"/assignments/{assignment_id}/submissions").json()] == ["S001", "S002", "S003"]


@pytest.mark.parametrize("encoding, prefix", [("cp949", ""), ("utf-8", "﻿")])
def test_excel_encodings(client, assignment_id, encoding, prefix):
    r = upload(client, assignment_id, prefix + "Student_ID , Answer\n20231234,역전파\n", encoding)
    assert r.status_code == 201
    assert r.json()[0]["clean_text"] == "역전파"


@pytest.mark.parametrize(
    "text, message",
    [
        ("id,answer\n1,a\n", "missing columns"),
        ("student_id,answer\n", "no rows"),
        ("student_id,answer\n,a\n", "line 2: student_id is empty"),
        ("student_id,answer\n1,a\n1,b\n", "line 3: duplicate"),
    ],
)
def test_invalid_csv(client, assignment_id, text, message):
    r = upload(client, assignment_id, text)
    assert r.status_code == 400
    assert message in r.json()["detail"]


def test_reupload_conflict_is_atomic(client, assignment_id):
    upload(client, assignment_id, CSV)
    r = upload(client, assignment_id, "student_id,answer\n20231299,새 답\n20231234,중복\n")
    assert r.status_code == 409
    assert len(client.get(f"/assignments/{assignment_id}/submissions").json()) == 2


def test_unknown_assignment(client):
    assert upload(client, 999999, CSV).status_code == 404


def test_delete(client, db, assignment_id):
    first, second = upload(client, assignment_id, CSV).json()
    item_id = client.get(f"/assignments/{assignment_id}").json()["items"][1]["id"]
    db.add(Grade(submission_id=second["id"], rubric_item_id=item_id, route="auto", recommended_pred=True, decision="accepted"))
    db.flush()
    assert client.delete(f"/submissions/{first['id']}").status_code == 204
    assert client.delete(f"/submissions/{second['id']}").status_code == 409  # confirmed grades
