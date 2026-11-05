"""Jev (TypeSafe System One) client and response handling.

Validated in notebooks/01_jev_response_check.ipynb.
"""

import os
import time
from typing import Any

import httpx

from app.judges.base import GATE, Judgment, Questions

URL = "https://api.typesafe.ai/v1/systemone"
DEFAULT_MODEL = "jev-1.13.0"  # pinned: thresholds are tuned per model version

# Provisional thresholds from notebook 01 (36 cells). Re-tune on the evaluation set.
# Noul confidence is |2p - 1|, so T_NOUL = 0.6 means p <= 0.2 or p >= 0.8.
T_NOUL = 0.6
T_OTHER = 0.8


def make_client(api_key: str | None = None, timeout: float = 30) -> httpx.Client:
    key = api_key or os.environ["TYPESAFE_API_KEY"]
    return httpx.Client(headers={"Authorization": f"Bearer {key}"}, timeout=timeout)


def call_jev(
    client: httpx.Client,
    state: Any,
    questions: dict,
    model: str = DEFAULT_MODEL,
    max_retries: int = 3,
) -> tuple[dict, float]:
    """Send one System One request. Returns (response JSON, latency in seconds)."""
    body = {"state": state, "model": model, "questions": questions}
    for attempt in range(max_retries + 1):
        t0 = time.perf_counter()
        r = client.post(URL, json=body)
        latency = time.perf_counter() - t0
        if r.status_code in (429, 529) and attempt < max_retries:
            time.sleep(float(r.headers.get("retry-after", 2**attempt)))
            continue
        if r.is_error:
            raise httpx.HTTPStatusError(f"{r.status_code}: {r.text}", request=r.request, response=r)
        return r.json(), latency
    raise RuntimeError("unreachable")


def parse_answers(data: dict) -> list[Judgment]:
    judgments = []
    for qid, a in data["answers"].items():
        if a["type"] == "noul":
            p = a["noul"]
            judgments.append(Judgment(qid, "noul", pred=p >= 0.5, conf=round(abs(2 * p - 1), 2), raw=p))
        elif a["type"] == "score":
            top = max(a["probabilities"], key=a["probabilities"].get)
            judgments.append(Judgment(qid, "score", pred=int(top), conf=a["confidence"], raw=a["score"]))
        elif a["type"] == "choice":
            judgments.append(Judgment(qid, "choice", pred=a["choice"], conf=a["confidence"], raw=a["probabilities"]))
    for j in judgments:
        j.confident = is_auto(j)
    return judgments


def apply_gate(judgments: list[Judgment], gate: str = GATE) -> list[Judgment]:
    """Mark every non-gate judgment as skipped when the gate question is confidently False.

    An unsure gate is escalated like any other question, so the rest are still judged.
    """
    gate_j = next((j for j in judgments if j.question_id == gate), None)
    if gate_j is None or gate_j.pred or not is_auto(gate_j):
        return judgments
    for j in judgments:
        j.skipped = j.question_id != gate
    return judgments


def is_auto(j: Judgment, t_noul: float = T_NOUL, t_other: float = T_OTHER) -> bool:
    """True if the judgment is confident enough to recommend without escalation.

    Does not look at `skipped`; callers filter skipped judgments first.
    """
    return j.conf is not None and j.conf >= (t_noul if j.type == "noul" else t_other)


class JevJudge:
    """Primary judge: fast structured judgments with confidence."""

    def __init__(self, client: httpx.Client | None = None, model: str = DEFAULT_MODEL):
        self.client = client or make_client()
        self.model = model
        self.last_latency: float = 0.0

    def evaluate(self, problem: str, answer: str, questions: Questions) -> list[Judgment]:
        data, self.last_latency = call_jev(self.client, {"question": problem, "answer": answer}, questions, self.model)
        return apply_gate(parse_answers(data))
