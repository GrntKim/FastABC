"""Shared types for judges.

Questions use the Jev request format, keyed by question id:
    {"type": "noul" | "score" | "choice", "instructions": ..., "criteria": ...}
"""

from dataclasses import dataclass, field
from typing import Protocol

Questions = dict[str, dict]


@dataclass
class Judgment:
    question_id: str
    type: str  # "noul" | "score" | "choice"
    pred: bool | int | str | None  # None: no valid judgment (route to a human)
    conf: float | None = None  # Jev only; LLM self-reported confidence is not used
    raw: float | dict[str, float] | None = None  # Jev noul p / score weighted mean / choice probabilities
    evidence: list[str] = field(default_factory=list)  # verbatim quotes from the answer (LLM only)
    reasoning: str | None = None  # LLM only
    skipped: bool = False  # gate question was False


class Judge(Protocol):
    def evaluate(self, problem: str, answer: str, questions: Questions) -> list[Judgment]: ...
