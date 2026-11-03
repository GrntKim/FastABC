"""Hybrid routing: primary judge first, escalate low-confidence questions, humans resolve disagreements.

Rules are code, not model output (CLAUDE.md design principle 3).
"""

from dataclasses import dataclass, field
from enum import StrEnum

from app.judges.base import Judge, Judgment, Questions
from app.judges.jev import is_auto


class Route(StrEnum):
    SKIP = "skip"  # gate question was False
    AUTO = "auto"  # primary judge confident: recommend its judgment
    LLM = "llm"  # escalated and both judges agree: recommend with LLM evidence
    HUMAN = "human"  # escalated and judges disagree (or LLM failed): grader decides, no recommendation


@dataclass
class Recommendation:
    question_id: str
    route: Route
    pred: bool | int | str | None  # None for SKIP and HUMAN
    primary: Judgment
    secondary: Judgment | None = None
    evidence: list[str] = field(default_factory=list)
    reasoning: str | None = None


def needs_escalation(j: Judgment) -> bool:
    return not j.skipped and not is_auto(j)


def route(primary: list[Judgment], secondary: list[Judgment]) -> list[Recommendation]:
    by_id = {j.question_id: j for j in secondary}
    recs = []
    for p in primary:
        if p.skipped:
            recs.append(Recommendation(p.question_id, Route.SKIP, None, p))
        elif not needs_escalation(p):
            recs.append(Recommendation(p.question_id, Route.AUTO, p.pred, p))
        else:
            s = by_id.get(p.question_id)
            if s is not None and s.pred is not None and s.pred == p.pred:
                recs.append(Recommendation(p.question_id, Route.LLM, p.pred, p, s, s.evidence, s.reasoning))
            else:
                recs.append(Recommendation(p.question_id, Route.HUMAN, None, p, s,
                                           s.evidence if s else [], s.reasoning if s else None))
    return recs


def grade(problem: str, answer: str, questions: Questions, primary: Judge, secondary: Judge) -> list[Recommendation]:
    """Run the primary judge, escalate only the questions that need it, then route."""
    first = primary.evaluate(problem, answer, questions)
    escalated = {j.question_id: questions[j.question_id] for j in first if needs_escalation(j)}
    second = secondary.evaluate(problem, answer, escalated) if escalated else []
    return route(first, second)
