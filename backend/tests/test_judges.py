"""Judge logic without network calls: decision-model parsing, evidence check, routing."""

from app.judges.base import Judgment, Questions
from app.judges.gemini import verify_evidence
from app.judges.jev import apply_gate, is_auto, parse_answers
from app.judges.routing import Route, grade, route


def test_parse_answers():
    data = {"answers": {
        "a": {"type": "noul", "noul": 0.9},
        "b": {"type": "score", "score": 1.8, "probabilities": {"0": 0.1, "1": 0.2, "2": 0.7}, "confidence": 0.85},
        "c": {"type": "choice", "choice": "x", "probabilities": {"x": 0.6, "y": 0.4}, "confidence": 0.5},
    }}
    a, b, c = parse_answers(data)
    assert (a.pred, a.conf, a.raw, a.confident) == (True, 0.8, 0.9, True)
    assert (b.pred, b.conf, b.confident) == (2, 0.85, True)
    assert (c.pred, c.conf, c.confident) == ("x", 0.5, False)  # the adapter applies its own thresholds


def test_thresholds():
    assert is_auto(Judgment("q", "noul", True, conf=0.6))
    assert not is_auto(Judgment("q", "noul", True, conf=0.59))
    assert not is_auto(Judgment("q", "score", 2, conf=0.79))
    assert not is_auto(Judgment("q", "noul", None))


def test_gate_false_skips_others():
    judgments = apply_gate([Judgment("is_on_topic", "noul", False, conf=0.9), Judgment("q", "noul", True, conf=0.9)])
    assert [j.skipped for j in judgments] == [False, True]


def test_verify_evidence_ignores_whitespace():
    answer = "알고리즘이\n가중치를 갱신\n하는 데 사용된다."
    quotes = ["가중치를 갱신하는 데 사용된다", "가중치를 갱신 하는", '"갱신하는"', "없는 문장", "  "]
    assert verify_evidence(answer, quotes) == quotes[:3]


def test_route():
    primary = [
        Judgment("is_on_topic", "noul", True, conf=0.9, confident=True),
        Judgment("agree", "noul", True, conf=0.1),
        Judgment("disagree", "noul", True, conf=0.1),
        Judgment("failed", "noul", True, conf=0.1),
        Judgment("skipped", "noul", True, conf=0.1, skipped=True),
    ]
    secondary = [
        Judgment("agree", "noul", True, evidence=["e"], reasoning="r"),
        Judgment("disagree", "noul", False),
        Judgment("failed", "noul", None),
    ]
    recs = {r.question_id: r for r in route(primary, secondary)}
    assert recs["is_on_topic"].route == Route.AUTO
    assert (recs["agree"].route, recs["agree"].pred, recs["agree"].evidence) == (Route.LLM, True, ["e"])
    assert (recs["disagree"].route, recs["disagree"].pred) == (Route.HUMAN, None)
    assert recs["failed"].route == Route.HUMAN
    assert recs["skipped"].route == Route.SKIP


class FakeJudge:
    def __init__(self, judgments: list[Judgment]):
        self.judgments = judgments
        self.calls: list[Questions] = []

    def evaluate(self, problem, answer, questions):
        self.calls.append(questions)
        return [j for j in self.judgments if j.question_id in questions]


def test_grade_sends_only_escalated_questions():
    questions = {"sure": {"type": "noul"}, "unsure": {"type": "noul"}}
    primary = FakeJudge([
        Judgment("sure", "noul", True, conf=0.9, confident=True),
        Judgment("unsure", "noul", False, conf=0.2),
    ])
    secondary = FakeJudge([Judgment("unsure", "noul", False)])
    recs = grade("p", "a", questions, primary, secondary)
    assert secondary.calls == [{"unsure": {"type": "noul"}}]
    assert [r.route for r in recs] == [Route.AUTO, Route.LLM]


def test_grade_skips_secondary_when_all_confident():
    secondary = FakeJudge([])
    primary = FakeJudge([Judgment("q", "noul", True, conf=0.9, confident=True)])
    grade("p", "a", {"q": {"type": "noul"}}, primary, secondary)
    assert secondary.calls == []
