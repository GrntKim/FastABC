import copy
import json
from pathlib import Path

import pytest

from app.models import Grade, Submission

FIXTURE = json.loads((Path(__file__).resolve().parents[2] / "data" / "backprop_v1.json").read_text())


def make_body() -> dict:
    items = []
    for key, q in FIXTURE["questions"]["ko"].items():
        item = {"key": key, **q}
        if key == "is_on_topic":
            item["kind"] = "gate"
        elif key.startswith("misc_"):
            item |= {"kind": "deduction", "points": 1}
        elif q["type"] == "score":
            item |= {"kind": "credit", "points_map": {"0": 0, "1": 1, "2": 2, "3": 4}}
        else:
            item |= {"kind": "credit", "points": 2}
        items.append(item)
    return {"title": "역전파", "problem": FIXTURE["problem"], "items": items}


@pytest.fixture
def assignment(client) -> dict:
    r = client.post("/assignments", json=make_body())
    assert r.status_code == 201
    return r.json()


def test_create(assignment):
    assert assignment["judge_model"] == "jev-1.13.0"
    assert assignment["items"][0]["label"] is None  # optional
    assert assignment["max_points"] == 8.0  # 2 + 2 + 4
    assert assignment["submission_count"] == 0
    assert [i["position"] for i in assignment["items"]] == list(range(7))


def test_list_and_get(client, assignment):
    assert [a["id"] for a in client.get("/assignments").json()] == [assignment["id"]]
    assert client.get(f"/assignments/{assignment['id']}").json()["items"] == assignment["items"]
    assert client.get("/assignments/999999").status_code == 404


@pytest.mark.parametrize(
    "mutate, message",
    [
        (lambda b: b["items"].pop(0), "exactly one gate item"),
        (lambda b: b["items"].append(b["items"][1]), "keys must be unique"),
        (lambda b: b["items"][3].update(points_map={"0": 0, "1": 1}), "points_map with keys"),
        (lambda b: b["items"][3].update(kind="deduction", points=1, points_map=None), "must be noul"),
        (lambda b: b["items"][1].update(criteria={"yes": "a"}), "noul criteria"),
        (lambda b: b["items"][0].update(points=1), "gate item has no points"),
        (lambda b: b["items"][1].update(key="is_on_topic"), "reserved"),
        (lambda b: b["items"][1].update(key="Chain Rule"), "should match pattern"),
    ],
)
def test_invalid_rubric(client, mutate, message):
    body = make_body()
    mutate(body)
    r = client.post("/assignments", json=body)
    assert r.status_code == 422
    assert message in r.json()["detail"][0]["msg"]


def test_replace(client, assignment):
    body = make_body()
    body["title"] = "역전파 v2"
    body["items"] = body["items"][:3]
    r = client.put(f"/assignments/{assignment['id']}", json=body)
    assert r.status_code == 200
    assert r.json()["title"] == "역전파 v2"
    assert len(r.json()["items"]) == 3
    assert r.json()["max_points"] == 4.0


def test_replace_refused_after_grading(client, db, assignment):
    sub = Submission(
        assignment_id=assignment["id"], student_ref="x", label="S001", raw_text="r", clean_text="c", extraction_status="ok"
    )
    db.add(sub)
    db.flush()
    db.add(Grade(submission_id=sub.id, rubric_item_id=assignment["items"][1]["id"], route="auto", recommended_pred=True))
    db.flush()
    assert client.put(f"/assignments/{assignment['id']}", json=make_body()).status_code == 409


def test_delete_cascades(client, db, assignment):
    db.add(Submission(
        assignment_id=assignment["id"], student_ref="x", label="S001", raw_text="r", clean_text="c", extraction_status="ok"
    ))
    db.flush()
    assert client.delete(f"/assignments/{assignment['id']}").status_code == 204
    assert client.get(f"/assignments/{assignment['id']}").status_code == 404
    assert db.query(Submission).count() == 0


def test_cors_preflight(client):
    headers = {"Origin": "http://localhost:3000", "Access-Control-Request-Method": "PATCH"}
    assert client.options("/assignments", headers=headers).headers["access-control-allow-origin"] == "http://localhost:3000"
    headers["Origin"] = "http://evil.example"
    assert "access-control-allow-origin" not in client.options("/assignments", headers=headers).headers


def test_label(client):
    body = make_body()
    body["items"][1]["label"] = "연쇄법칙 언급"
    item = client.post("/assignments", json=body).json()["items"][1]
    assert (item["key"], item["label"]) == ("mentions_chain_rule", "연쇄법칙 언급")
