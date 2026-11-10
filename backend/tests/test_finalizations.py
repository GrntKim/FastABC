import re

import pytest

from tests.test_grading import grading  # noqa: F401  (fixture)
from tests.test_review import graded  # noqa: F401  (fixture)
from tests.test_submissions import upload

SIGN = {"confirmed": True}  # the signer is the logged-in grader


@pytest.fixture
def decided(client, graded):  # noqa: F811
    """Every cell of the two answers decided: 11 accepted, 1 entered by hand."""
    aid, cells = graded["aid"], graded["cells"]
    client.post(f"/assignments/{aid}/accept-confident")
    client.patch(f"/grades/{cells['b', 'mentions_chain_rule']['grade_id']}", json={"action": "accept"})
    client.patch(f"/grades/{cells['b', 'misc_is_optimizer']['grade_id']}", json={"action": "set", "points": -1})
    return graded


def test_needs_every_cell_decided(client, graded):  # noqa: F811
    assert client.post(f"/assignments/{graded['aid']}/finalizations", json=SIGN).status_code == 409


@pytest.mark.parametrize("body", [{"confirmed": False}, {}])
def test_needs_confirmation(client, decided, body):
    assert client.post(f"/assignments/{decided['aid']}/finalizations", json=body).status_code == 422


def test_finalize_locks(client, decided):
    aid, cells = decided["aid"], decided["cells"]
    r = client.post(f"/assignments/{aid}/finalizations", json=SIGN)
    assert r.status_code == 201
    f = r.json()
    assert (f["version"], f["finalized_by"], f["reopened_at"]) == (1, "김조교", None)
    assert f["counts"] == {"accepted": 11, "modified": 0, "manual": 1}
    assert re.fullmatch(r"[0-9a-f]{64}", f["snapshot_hash"])
    assert client.get(f"/assignments/{aid}").json()["progress"]["stage"] == "finalized"

    grade_id = cells["a", "accuracy"]["grade_id"]
    assert client.patch(f"/grades/{grade_id}", json={"action": "clear"}).status_code == 409
    assert client.post(f"/assignments/{aid}/accept-confident").status_code == 409
    assert client.post(f"/assignments/{aid}/clear-decisions").status_code == 409
    assert upload(client, aid, "student_id,answer\n20239999,답\n").status_code == 409
    assert client.post(f"/assignments/{aid}/finalizations", json=SIGN).status_code == 409

    disposition = client.get(f"/assignments/{aid}/export.csv").headers["content-disposition"]
    assert f'assignment_{aid}_v1_{f["snapshot_hash"][:8]}.csv' in disposition


def test_reopen_and_revise(client, decided):
    aid, cells = decided["aid"], decided["cells"]
    assert client.post(f"/assignments/{aid}/reopen", json={"reason": "x"}).status_code == 409  # nothing to reopen
    v1 = client.post(f"/assignments/{aid}/finalizations", json=SIGN).json()

    assert client.post(f"/assignments/{aid}/reopen", json={"reason": " "}).status_code == 422
    r = client.post(f"/assignments/{aid}/reopen", json={"reason": "이의 제기 반영"})
    assert (r.status_code, r.json()["reopen_reason"]) == (200, "이의 제기 반영")
    assert client.get(f"/assignments/{aid}").json()["progress"]["stage"] == "done"

    same = client.post(f"/assignments/{aid}/finalizations", json=SIGN).json()
    assert (same["version"], same["snapshot_hash"]) == (2, v1["snapshot_hash"])  # unchanged grades, same hash

    client.post(f"/assignments/{aid}/reopen", json={"reason": "점수 수정"})
    grade_id = cells["a", "accuracy"]["grade_id"]
    assert client.patch(f"/grades/{grade_id}", json={"action": "set", "points": 2}).status_code == 200
    v3 = client.post(f"/assignments/{aid}/finalizations", json=SIGN).json()
    assert v3["version"] == 3 and v3["snapshot_hash"] != v1["snapshot_hash"]
    assert v3["counts"] == {"accepted": 10, "modified": 1, "manual": 1}

    history = client.get(f"/assignments/{aid}/finalizations").json()
    assert [h["version"] for h in history] == [3, 2, 1]
    assert [h["reopen_reason"] for h in history] == [None, "점수 수정", "이의 제기 반영"]


def test_due_date_is_soft(client, decided):
    aid = decided["aid"]
    term = client.get(f"/assignments/{aid}").json()["course"]["term"]
    client.put(f"/terms/{term}", json={"grades_due": "2000-01-31"})
    r = client.post(f"/assignments/{aid}/finalizations", json=SIGN)
    assert (r.status_code, r.json()["detail"]) == (409, "이 학기 성적 입력 마감일(2000-01-31)이 지났습니다")

    f = client.post(f"/assignments/{aid}/finalizations", json=SIGN | {"late_ok": True}).json()
    assert (f["version"], f["late"]) == (1, True)  # signed off anyway, and recorded as late

    client.post(f"/assignments/{aid}/reopen", json={"reason": "x"})
    client.put(f"/terms/{term}", json={"grades_due": "2999-12-31"})
    assert client.post(f"/assignments/{aid}/finalizations", json=SIGN).json()["late"] is False


def test_unknown_assignment(client):
    assert client.get("/assignments/999999/finalizations").status_code == 404
    assert client.post("/assignments/999999/finalizations", json=SIGN).status_code == 404
    assert client.post("/assignments/999999/reopen", json={"reason": "x"}).status_code == 404
