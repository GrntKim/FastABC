"""Grading run with fake judges: no external API calls."""

from contextlib import nullcontext

import httpx
import pytest

from app.db import get_session_factory
from app.grading import Judges, get_judges
from app.judges.base import Judgment
from app.judges.jev import apply_gate, is_auto
from app.main import app as fastapi_app
from app.models import Grade, GradeRoute, JudgmentRecord, RubricItem, Submission
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

    model = "fake-primary"
    last_latency = 0.2

    def __init__(self, overrides: dict[str, dict] | None = None, error: Exception | None = None):
        self.overrides = overrides or {}
        self.error = error

    def evaluate(self, problem, answer, questions):
        if self.error:
            raise self.error
        script = CONFIDENT | self.overrides.get(answer, {})
        types = {k: q["type"] for k, q in questions.items()}
        judgments = [Judgment(k, types[k], *script[k]) for k in questions]
        for j in judgments:
            j.confident = is_auto(j)  # same thresholds as the real decision-model adapter
        return apply_gate(judgments)


class FakeSecondary:
    model = "fake-secondary"

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
def grading(client, db, course_id):
    def setup(primary, secondary, answers: list[str]):
        fastapi_app.dependency_overrides[get_judges] = lambda: Judges(primary, secondary)
        fastapi_app.dependency_overrides[get_session_factory] = lambda: lambda: nullcontext(db)
        aid = client.post("/assignments", json=make_body(course_id)).json()["id"]
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
    assert r.json()["total"] == 12  # the gate is judged but is not a cell

    # background task ran after the response
    assert secondary.calls == [("b", ["mentions_chain_rule", "misc_is_optimizer"])]
    c = cells(db)
    assert (c["a", "accuracy"].route, c["a", "accuracy"].recommended_points) == ("auto", 4)
    assert ("a", "is_on_topic") not in c
    assert (c["b", "mentions_chain_rule"].route, c["b", "mentions_chain_rule"].recommended_points) == ("llm", 2)
    assert (c["b", "misc_is_optimizer"].route, c["b", "misc_is_optimizer"].recommended_pred) == ("human", None)

    status = client.get(f"/assignments/{aid}/grading").json()
    assert status == {"total": 12, "pending": 0, "done": True, "routes": {"auto": 10, "llm": 1, "human": 1}, "ungraded": 0}

    records = db.query(JudgmentRecord).all()
    assert sum(r.source == "primary" for r in records) == 14
    secondary = [r for r in records if r.source == "secondary"]
    assert len(secondary) == 2 and secondary[0].evidence == ["근거"] and secondary[0].model == "fake-secondary"
    assert {r.latency_ms for r in records if r.source == "primary"} == {200}


def test_confident_gate_false_skips(client, db, grading):
    secondary = FakeSecondary()
    aid = grading(FakePrimary({"off": {"is_on_topic": (False, 0.9), "accuracy": (3, 0.1)}}), secondary, ["off"])
    client.post(f"/assignments/{aid}/grade")
    c = cells(db)
    assert {(g.route, g.recommended_points) for g in c.values()} == {("skip", 0)}
    assert secondary.calls == []


def test_unsure_gate_does_not_skip(client, db, grading):
    secondary = FakeSecondary()
    aid = grading(FakePrimary({"x": {"is_on_topic": (False, 0.2)}}), secondary, ["x"])
    client.post(f"/assignments/{aid}/grade")
    c = cells(db)
    assert ("x", "is_on_topic") not in c and c["x", "accuracy"].route == "auto"
    assert secondary.calls == []  # an unsure gate needs no re-judgment: it only matters when confidently False


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
    assert db.query(Grade).count() == 6  # the gate is judged but is not a cell
    assert db.query(JudgmentRecord).count() == 7

    db.query(Grade).first().decision = "accepted"
    db.flush()
    assert client.post(f"/assignments/{aid}/grade").status_code == 409


def test_no_submissions_and_unknown(client, course_id, grading):
    fastapi_app.dependency_overrides[get_judges] = lambda: Judges(FakePrimary(), FakeSecondary())
    aid = client.post("/assignments", json=make_body(course_id)).json()["id"]
    assert client.post(f"/assignments/{aid}/grade").status_code == 400
    assert client.post("/assignments/999999/grade").status_code == 404
    assert client.get("/assignments/999999/grading").status_code == 404


def test_grade_only_new_answers(client, db, grading):
    """An answer added after grading started gets graded alone; confirmed grades stay."""
    primary = FakePrimary({"b": {"mentions_chain_rule": (True, 0.2)}})
    secondary = FakeSecondary({"b": {"mentions_chain_rule": True}})
    aid = grading(primary, secondary, ["a"])
    client.post(f"/assignments/{aid}/grade")
    first = client.get(f"/assignments/{aid}/cells").json()[0]
    client.patch(f"/grades/{first['grade_id']}", json={"action": "set", "points": 0})

    csv = "student_id,answer\n20239999,b\n"
    client.post(f"/assignments/{aid}/submissions/csv", files={"file": ("b.csv", csv.encode(), "text/csv")})
    assert client.get(f"/assignments/{aid}/grading").json()["ungraded"] == 1
    assert client.get(f"/assignments/{aid}").json()["progress"]["stage"] == "review"  # waits for the new answer
    assert client.post(f"/assignments/{aid}/grade").status_code == 409  # a full re-grade would drop the decision

    r = client.post(f"/assignments/{aid}/grade", params={"only_new": True})
    assert r.status_code == 202 and r.json()["ungraded"] == 0
    cells = client.get(f"/assignments/{aid}/cells").json()
    assert {c["answer"] for c in cells} == {"a", "b"} and len(cells) == 12
    assert next(c for c in cells if c["grade_id"] == first["grade_id"])["final_points"] == 0  # kept
    assert next(c for c in cells if c["answer"] == "b" and c["item_key"] == "mentions_chain_rule")["route"] == "llm"
    assert client.post(f"/assignments/{aid}/grade", params={"only_new": True}).status_code == 400  # nothing new


def test_secondary_calls_run_a_few_at_a_time(client, grading):
    """Escalated answers are re-judged concurrently; each result still lands on its own cells."""
    import threading
    import time

    class SlowSecondary(FakeSecondary):
        def __init__(self, preds):
            super().__init__(preds)
            self.running = self.peak = 0
            self.lock = threading.Lock()

        def evaluate(self, problem, answer, questions):
            with self.lock:
                self.running += 1
                self.peak = max(self.peak, self.running)
            time.sleep(0.05)
            with self.lock:
                self.running -= 1
            return super().evaluate(problem, answer, questions)

    answers = [f"a{i}" for i in range(8)]
    primary = FakePrimary({a: {"accuracy": (2, 0.5)} for a in answers})  # every answer escalates one cell
    secondary = SlowSecondary({a: {"accuracy": 2 if i % 2 else 1} for i, a in enumerate(answers)})
    aid = grading(primary, secondary, answers)
    client.post(f"/assignments/{aid}/grade")

    assert 1 < secondary.peak <= 4
    routes = {c["label"]: c["route"] for c in client.get(f"/assignments/{aid}/cells").json() if c["item_key"] == "accuracy"}
    assert routes == {f"S{i + 1:03d}": "llm" if i % 2 else "human" for i in range(8)}  # agreed vs split, per answer


def test_audit_takes_one_item_from_a_tenth_of_the_answers(client, grading, db, monkeypatch):
    monkeypatch.setattr("app.grading.SAMPLE_RATE", 0.1)
    aid = grading(FakePrimary(), FakeSecondary(), [f"answer {i}" for i in range(40)])
    client.post(f"/assignments/{aid}/grade")
    sampled = [g for g in cells(db).values() if g.sampled]
    assert len(sampled) == 4 and len({g.submission_id for g in sampled}) == 4
    assert all(g.route == GradeRoute.AUTO for g in sampled)


def test_a_small_class_still_gets_one_audit(client, grading, db, monkeypatch):
    monkeypatch.setattr("app.grading.SAMPLE_RATE", 0.1)
    aid = grading(FakePrimary(), FakeSecondary(), ["a", "b", "c"])
    client.post(f"/assignments/{aid}/grade")
    assert sum(g.sampled for g in cells(db).values()) == 1
