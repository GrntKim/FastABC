import csv
import io

import pytest

from app.grading import Judges, get_judges
from app.main import app as fastapi_app
from app.models import Grade
from tests.test_grading import FakePrimary, FakeSecondary, grading  # noqa: F401  (fixture)


@pytest.fixture
def graded(client, grading) -> dict:
    """Two answers. "b": chain_rule escalated and agreed (llm), misc_is_optimizer escalated and disputed (human)."""
    primary = FakePrimary({"b": {"mentions_chain_rule": (True, 0.2), "misc_is_optimizer": (True, 0.3)}})
    secondary = FakeSecondary({"b": {"mentions_chain_rule": True, "misc_is_optimizer": False}})
    aid = grading(primary, secondary, ["a", "b"])
    client.post(f"/assignments/{aid}/grade")
    items = {i["key"]: i["id"] for i in client.get(f"/assignments/{aid}").json()["items"]}
    cells = {(c["answer"], c["item_key"]): c for c in client.get(f"/assignments/{aid}/cells").json()}
    return {"aid": aid, "items": items, "cells": cells}


def test_cells(client, graded):
    aid, items, cells = graded["aid"], graded["items"], graded["cells"]
    assert len(cells) == 12 and ("a", "is_on_topic") not in cells  # the gate is not a cell

    column = client.get(f"/assignments/{aid}/cells", params={"item_id": items["accuracy"]}).json()
    assert [c["label"] for c in column] == ["S001", "S002"]
    assert column[0]["primary"]["conf"] == 0.9 and column[0]["secondary"] is None

    row = client.get(f"/assignments/{aid}/cells", params={"submission_id": column[1]["submission_id"]}).json()
    assert [c["item_key"] for c in row][:2] == ["mentions_chain_rule", "mentions_weight_update"]

    human = cells["b", "misc_is_optimizer"]
    assert human["route"] == "human" and human["recommended_points"] is None
    assert human["secondary"]["evidence"] == ["근거"]  # reference for the grader
    assert all(c["final_points"] is None for c in cells.values())  # never pre-filled


def test_accept_set_clear(client, graded):
    cells = graded["cells"]
    auto, human = cells["a", "accuracy"], cells["b", "misc_is_optimizer"]

    r = client.patch(f"/grades/{auto['grade_id']}", json={"action": "accept"}).json()
    assert (r["final_points"], r["decision"]) == (4, "accepted")

    r = client.patch(f"/grades/{auto['grade_id']}", json={"action": "set", "points": 2}).json()
    assert (r["final_points"], r["decision"]) == (2, "modified")

    r = client.patch(f"/grades/{auto['grade_id']}", json={"action": "set", "points": 4}).json()
    assert r["decision"] == "accepted"  # same as the recommendation

    assert client.patch(f"/grades/{human['grade_id']}", json={"action": "accept"}).status_code == 409
    r = client.patch(f"/grades/{human['grade_id']}", json={"action": "set", "points": -1}).json()
    assert (r["final_points"], r["decision"]) == (-1, "manual")

    r = client.patch(f"/grades/{human['grade_id']}", json={"action": "clear"}).json()
    assert (r["final_points"], r["decision"], r["decided_at"]) == (None, None, None)


@pytest.mark.parametrize(
    "key, points",
    [("misc_is_optimizer", 1), ("misc_is_optimizer", -2), ("accuracy", 5)],
)
def test_points_out_of_range(client, graded, key, points):
    grade_id = graded["cells"]["a", key]["grade_id"]
    assert client.patch(f"/grades/{grade_id}", json={"action": "set", "points": points}).status_code == 422


def test_invalid_body_and_pending(client, db, graded):
    grade_id = graded["cells"]["a", "accuracy"]["grade_id"]
    assert client.patch(f"/grades/{grade_id}", json={"action": "set"}).status_code == 422
    assert client.patch(f"/grades/{grade_id}", json={"action": "accept", "points": 1}).status_code == 422
    assert client.patch("/grades/999999", json={"action": "accept"}).status_code == 404

    db.get(Grade, grade_id).route = "pending"
    db.flush()
    assert client.patch(f"/grades/{grade_id}", json={"action": "accept"}).status_code == 409


def test_accept_confident(client, graded):
    aid, items, cells = graded["aid"], graded["items"], graded["cells"]
    client.patch(f"/grades/{cells['a', 'accuracy']['grade_id']}", json={"action": "set", "points": 1})

    r = client.post(f"/assignments/{aid}/accept-confident", params={"item_id": items["mentions_weight_update"]})
    assert r.json() == {"accepted": 2}

    assert client.post(f"/assignments/{aid}/accept-confident").json() == {"accepted": 7}  # 12 - 2 - llm - human - modified
    after = {(c["answer"], c["item_key"]): c for c in client.get(f"/assignments/{aid}/cells").json()}
    assert after["a", "accuracy"]["decision"] == "modified"  # not overwritten
    assert after["b", "mentions_chain_rule"]["decision"] is None  # llm needs a look
    assert after["b", "misc_is_optimizer"]["decision"] is None


def test_results_and_export(client, graded):
    aid, cells = graded["aid"], graded["cells"]
    client.post(f"/assignments/{aid}/accept-confident")
    a, b = client.get(f"/assignments/{aid}/results").json()
    assert (a["label"], a["decided"], a["cells"], a["total"], a["max_points"]) == ("S001", 6, 6, 8, 8)
    assert (b["decided"], b["total"]) == (4, None)

    client.patch(f"/grades/{cells['b', 'mentions_chain_rule']['grade_id']}", json={"action": "accept"})
    client.patch(f"/grades/{cells['b', 'misc_is_optimizer']['grade_id']}", json={"action": "set", "points": -1})
    assert client.get(f"/assignments/{aid}/results").json()[1]["total"] == 7

    r = client.get(f"/assignments/{aid}/export.csv")
    assert r.headers["content-type"].startswith("text/csv")
    assert r.text.startswith("﻿")
    rows = list(csv.reader(io.StringIO(r.text.lstrip("﻿"))))
    assert rows[0] == ["student_id", "label", "mentions_chain_rule", "mentions_weight_update", "accuracy",
                       "misc_is_optimizer", "misc_error_copied", "misc_reverse_inference", "total"]
    assert rows[2][1:] == ["S002", "2.0", "2.0", "4.0", "-1.0", "0.0", "0.0", "7.0"]


def test_unknown_assignment(client):
    for path in ("cells", "results", "export.csv"):
        assert client.get(f"/assignments/999999/{path}").status_code == 404
    assert client.post("/assignments/999999/accept-confident").status_code == 404


def test_sampled_cells_excluded_from_bulk_accept(client, grading, monkeypatch):
    monkeypatch.setattr("app.grading.SAMPLE_RATE", 1.0)
    aid = grading(FakePrimary(), FakeSecondary(), ["a"])
    client.post(f"/assignments/{aid}/grade")
    cells = client.get(f"/assignments/{aid}/cells").json()
    assert all(c["sampled"] for c in cells if c["route"] == "auto")
    assert client.post(f"/assignments/{aid}/accept-confident").json() == {"accepted": 0}
    r = client.patch(f"/grades/{cells[1]['grade_id']}", json={"action": "accept"})
    assert r.json()["decision"] == "accepted"  # still accepted one by one


def test_accept_confident_for_one_submission(client, graded):
    aid, cells = graded["aid"], graded["cells"]
    sid = cells["b", "accuracy"]["submission_id"]
    assert client.post(f"/assignments/{aid}/accept-confident", params={"submission_id": sid}).json() == {"accepted": 4}
    after = client.get(f"/assignments/{aid}/cells", params={"submission_id": cells["a", "accuracy"]["submission_id"]}).json()
    assert all(c["decision"] is None for c in after)  # other submission untouched


def test_clear_decisions(client, graded):
    aid, items, cells = graded["aid"], graded["items"], graded["cells"]
    client.post(f"/assignments/{aid}/accept-confident")  # 10 cells: all but llm and human
    client.patch(f"/grades/{cells['b', 'misc_is_optimizer']['grade_id']}", json={"action": "set", "points": -1})

    r = client.post(f"/assignments/{aid}/clear-decisions", params={"item_id": items["accuracy"]})
    assert r.json() == {"cleared": 2}
    sid = cells["b", "accuracy"]["submission_id"]
    assert client.post(f"/assignments/{aid}/clear-decisions", params={"submission_id": sid}).json() == {"cleared": 4}
    assert client.post(f"/assignments/{aid}/clear-decisions").json() == {"cleared": 5}  # rest of "a"
    assert all(c["decision"] is None for c in client.get(f"/assignments/{aid}/cells").json())


def test_find_evidence(client, db, graded):
    aid, cells = graded["aid"], graded["cells"]
    sid = cells["b", "accuracy"]["submission_id"]
    secondary = FakeSecondary({"b": {"accuracy": 3}})
    fastapi_app.dependency_overrides[get_judges] = lambda: Judges(FakePrimary(), secondary)

    # 6 scored items; chain_rule and misc_is_optimizer already have escalation output
    assert client.post(f"/submissions/{sid}/evidence").json() == {"requested": 4}
    assert sorted(secondary.calls[0][1]) == ["accuracy", "mentions_weight_update", "misc_error_copied", "misc_reverse_inference"]
    row = {c["item_key"]: c for c in client.get(f"/assignments/{aid}/cells", params={"submission_id": sid}).json()}
    assert row["accuracy"]["evidence"]["evidence"] == ["근거"]
    assert row["accuracy"]["route"] == "auto"  # display only
    assert row["mentions_chain_rule"]["evidence"] is None and row["mentions_chain_rule"]["secondary"] is not None

    assert client.post(f"/submissions/{sid}/evidence").json() == {"requested": 0}  # cached
    assert len(secondary.calls) == 1
    assert client.post("/submissions/999999/evidence").status_code == 404


def test_find_evidence_failure(client, graded):
    sid = graded["cells"]["a", "accuracy"]["submission_id"]
    fastapi_app.dependency_overrides[get_judges] = lambda: Judges(FakePrimary(), FakeSecondary(error=RuntimeError("quota")))
    assert client.post(f"/submissions/{sid}/evidence").status_code == 502


def test_find_evidence_uses_evidence_judge(client, graded):
    sid = graded["cells"]["a", "accuracy"]["submission_id"]
    secondary, evidence = FakeSecondary(), FakeSecondary()
    fastapi_app.dependency_overrides[get_judges] = lambda: Judges(FakePrimary(), secondary, evidence=evidence)
    client.post(f"/submissions/{sid}/evidence")
    assert (len(secondary.calls), len(evidence.calls)) == (0, 1)
