"""Shared types for judges. Nothing here depends on a particular model vendor.

Questions share one format, keyed by question id:
    {"type": "noul" | "score" | "choice", "instructions": ..., "criteria": ...}
"""

from dataclasses import dataclass, field
from typing import Protocol

Questions = dict[str, dict]

# Gate question every rubric has: when the primary judge is sure it is False, the other questions are skipped
GATE = "is_on_topic"


@dataclass
class Judgment:
    question_id: str
    type: str  # "noul" | "score" | "choice"
    pred: bool | int | str | None  # None: no valid judgment (route to a human)
    conf: float | None = None  # decision model only; LLM self-reported confidence is not used
    # set by the judge from its own calibrated thresholds; routing reads only this, never conf
    confident: bool = False
    raw: float | dict[str, float] | None = None  # decision model: noul p / score weighted mean / choice probabilities
    evidence: list[str] = field(default_factory=list)  # verbatim quotes from the answer (LLM only)
    reasoning: str | None = None  # LLM only
    skipped: bool = False  # gate question was False


class Judge(Protocol):
    def evaluate(self, problem: str, answer: str, questions: Questions) -> list[Judgment]: ...
