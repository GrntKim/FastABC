"""Grading run with fake judges: no external API calls."""

from contextlib import nullcontext

import httpx
import pytest

from app.db import get_session_factory
from app.grading import Judges, get_judges
from app.judges.base import Judgment
from app.judges.jev import apply_gate
from app.main import app as fastapi_app
from app.models import Grade, JudgmentRecord, RubricItem, Submission
from tests.test_assignments import make_body

CONFIDENT = {
    "is_on_topic": (True, 0.9),
    "mentions_chain_rule": (True, 0.9),
    "mentions_weight_update": (True, 0.9),
    "accuracy": (3, 0.9),
    "misc_is_optimizer": (False, 0.9),
    "misc_error_copied": (False, 0.9),
    "misc_reverse_inference": (False, 0.9),
}


class FakePrimary:
    """Answers by answer text: {answer: {key: (pred, conf)}}, CONFIDENT for unlisted keys."""

    model = "fake-jev"
    last_latency = 0.2

    def __init__(self, overrides: dict[str, dict] | None = None, error: Exception | None = None):
        self.overrides = overrides or {}
        self.error = error

    def evaluate(self, problem, answer, questions):
        if self.error:
            raise self.error
        script = CONFIDENT | self.overrides.get(answer, {})
        types = {k: q["type"] for k, q in questions.items()}
        return apply_gate([Judgment(k, types[k], *script[k]) for k in questions])


class FakeSecondary:
    model = "fake-gemini"

    def __init__(self, preds: dict[str, dict] | None = None, error: Exception | None = None):
        self.preds = preds or {}
        self.error = error
        self.calls: list[tuple[str, list[str]]] = []

    def evaluate(self, problem, answer, questions):
        self.calls.append((answer, list(questions)))
        if self.error:
            raise self.error
        return [
            Judgment(k, q["type"], self.preds.get(answer, {}).get(k), evidence=["근거"], reasoning="이유")
            for k, q in questions.items()
        ]


@pytest.fixture
def grading(client, db):
    def setup(primary, secondary, answers: list[str]):
        fastapi_app.dependency_overrides[get_judges] = lambda: Judges(primary, secondary)
        fastapi_app.dependency_overrides[get_session_factory] = lambda: lambda: nullcontext(db)
        aid = client.post("/assignments", json=make_body()).json()["id"]
        csv = "student_id,answer\n" + "".join(f"2023{i:04d},{a}\n" for i, a in enumerate(answers))
        client.post(f"/assignments/{aid}/submissions/csv", files={"file": ("a.csv", csv.encode(), "text/csv")})
        return aid

    return setup


def cells(db) -> dict[tuple[str, str], Grade]:
    """(answer text, item key) -> Grade"""
    rows = db.query(Grade, Submission.clean_text, RubricItem.key).join(Submission).join(RubricItem).all()
    return {(answer, key): g for g, answer, key in rows}


def test_routes_and_points(client, db, grading):
    primary = FakePrimary({"b": {"mentions_chain_rule": (True, 0.2), "misc_is_optimizer": (True, 0.3)}})
    secondary = FakeSecondary({"b": {"mentions_chain_rule": True, "misc_is_optimizer": False}})
    aid = grading(primary, secondary, ["a", "b"])

    r = client.post(f"/assignments/{aid}/grade")
    assert r.status_code == 202
    assert r.json()["total"] == 14

    # background task ran after the response
    assert secondary.calls == [("b", ["mentions_chain_rule", "misc_is_optimizer"])]
    c = cells(db)
    assert (c["a", "accuracy"].route, c["a", "accuracy"].recommended_points) == ("auto", 4)
    assert (c["a", "is_on_topic"].route, c["a", "is_on_topic"].recommended_points) == ("auto", 0)
    assert (c["b", "mentions_chain_rule"].route, c["b", "mentions_chain_rule"].recommended_points) == ("llm", 2)
    assert (c["b", "misc_is_optimizer"].route, c["b", "misc_is_optimizer"].recommended_pred) == ("human", None)

    status = client.get(f"/assignments/{aid}/grading").json()
    assert status == {"total": 14, "pending": 0, "done": True, "routes": {"auto": 12, "llm": 1, "human": 1}}

    records = db.query(JudgmentRecord).all()
    assert sum(r.source == "jev" for r in records) == 14
    gemini = [r for r in records if r.source == "gemini"]
    assert len(gemini) == 2 and gemini[0].evidence == ["근거"] and gemini[0].model == "fake-gemini"
    assert {r.latency_ms for r in records if r.source == "jev"} == {200}


def test_confident_gate_false_skips(client, db, grading):
    secondary = FakeSecondary()
    aid = grading(FakePrimary({"off": {"is_on_topic": (False, 0.9), "accuracy": (3, 0.1)}}), secondary, ["off"])
    client.post(f"/assignments/{aid}/grade")
    c = cells(db)
    assert c["off", "is_on_topic"].route == "auto"
    assert {(g.route, g.recommended_points) for k, g in c.items() if k[1] != "is_on_topic"} == {("skip", 0)}
    assert secondary.calls == []


def test_unsure_gate_does_not_skip(client, db, grading):
    secondary = FakeSecondary({"x": {"is_on_topic": True}})
    aid = grading(FakePrimary({"x": {"is_on_topic": (False, 0.2)}}), secondary, ["x"])
    client.post(f"/assignments/{aid}/grade")
    c = cells(db)
    assert c["x", "is_on_topic"].route == "human"  # judges disagree
    assert c["x", "accuracy"].route == "auto"


def test_secondary_failure_routes_to_human(client, db, grading):
    secondary = FakeSecondary(error=RuntimeError("quota"))
    aid = grading(FakePrimary({"x": {"accuracy": (2, 0.5)}}), secondary, ["x"])
    client.post(f"/assignments/{aid}/grade")
    assert cells(db)["x", "accuracy"].route == "human"
    assert client.get(f"/assignments/{aid}/grading").json()["done"]


def test_primary_failure(client, db, grading):
    error = httpx.HTTPError("503")
    aid = grading(FakePrimary(error=error), FakeSecondary(), ["x"])
    assert client.post(f"/assignments/{aid}/grade").status_code == 502
    assert db.query(Grade).count() == 0


def test_regrade_replaces_and_confirmed_blocks(client, db, grading):
    aid = grading(FakePrimary(), FakeSecondary(), ["x"])
    client.post(f"/assignments/{aid}/grade")
    client.post(f"/assignments/{aid}/grade")
    assert db.query(Grade).count() == 7
    assert db.query(JudgmentRecord).count() == 7

    db.query(Grade).first().decision = "accepted"
    db.flush()
    assert client.post(f"/assignments/{aid}/grade").status_code == 409


def test_no_submissions_and_unknown(client, grading):
    fastapi_app.dependency_overrides[get_judges] = lambda: Judges(FakePrimary(), FakeSecondary())
    aid = client.post("/assignments", json=make_body()).json()["id"]
    assert client.post(f"/assignments/{aid}/grade").status_code == 400
    assert client.post("/assignments/999999/grade").status_code == 404
    assert client.get("/assignments/999999/grading").status_code == 404
