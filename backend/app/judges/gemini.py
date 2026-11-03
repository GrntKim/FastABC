"""Gemini judge: re-judges escalated questions with evidence and reasoning.

Validated in notebooks/02_gemini_escalation.ipynb. Also serves as the LLM-only baseline.
Unpaid (free tier) API input may be used by Google and read by human reviewers:
use a billed Cloud project before sending real student answers.
"""

import logging
import time
from typing import Literal

from google import genai
from pydantic import BaseModel, ValidationError

from app.judges.base import Judgment, Questions

logger = logging.getLogger(__name__)

DEFAULT_MODEL = "gemini-3.6-flash"  # pinned (Stable)

SYSTEM = """당신은 대학 서술형 답안 채점 보조자입니다. 채점 기준 질문마다 답안을 판단하지만, 점수를 확정하지는 않습니다.

규칙:
- 각 질문은 서로 독립적으로 판단한다.
- 항목의 type은 질문 제목 괄호 안의 타입과 같아야 한다.
- noul: verdict에 true 또는 false를 쓴다.
- score: level에 해당하는 수준 번호(0부터)를 쓴다.
- choice: choice에 선택지 이름 중 하나를 그대로 쓴다.
- evidence: 판단 근거가 된 문장을 answer에서 글자 그대로 복사한다. 요약하거나 고쳐 쓰지 않는다. 근거 문장이 없으면 빈 리스트로 둔다.
- reasoning: 판단 이유를 한국어 1~2문장으로 쓴다.
- 주어진 모든 질문에 대해 question_id별로 정확히 하나의 항목을 출력한다."""


class NoulItem(BaseModel):
    type: Literal["noul"]
    question_id: str
    verdict: bool
    evidence: list[str]
    reasoning: str


class ScoreItem(BaseModel):
    type: Literal["score"]
    question_id: str
    level: int
    evidence: list[str]
    reasoning: str


class ChoiceItem(BaseModel):
    type: Literal["choice"]
    question_id: str
    choice: str
    evidence: list[str]
    reasoning: str


class GeminiResult(BaseModel):
    items: list[NoulItem | ScoreItem | ChoiceItem]


def format_question(qid: str, q: dict) -> str:
    lines = [f"### {qid} ({q['type']})", str(q["instructions"])]
    criteria = q.get("criteria")
    if q["type"] == "noul" and criteria:
        lines += [f"- true: {criteria['true']}", f"- false: {criteria['false']}"]
    elif q["type"] == "score":
        lines += [f"- {i}: {desc}" for i, desc in enumerate(criteria)]
    elif q["type"] == "choice":
        lines += [f"- {name}: {desc or ''}" for name, desc in criteria.items()]
    return "\n".join(lines)


def build_prompt(problem: str, answer: str, questions: Questions) -> str:
    qs = "\n\n".join(format_question(qid, q) for qid, q in questions.items())
    return f"## question (문제)\n{problem}\n\n## answer (답안)\n{answer}\n\n## 판단할 질문\n{qs}"


def _normalize(s: str) -> str:
    return " ".join(s.split()).strip(" .,\"'“”‘’")


def verify_evidence(answer: str, quotes: list[str]) -> list[str]:
    """Keep only quotes that appear verbatim (whitespace-normalized) in the answer."""
    text = " ".join(answer.split())
    return [q for q in quotes if _normalize(q) and _normalize(q) in text]


def _to_judgment(item: NoulItem | ScoreItem | ChoiceItem, q: dict, answer: str) -> Judgment | None:
    """Convert a schema item into a Judgment, or None if it does not fit the question."""
    if item.type != q["type"]:
        return None
    if isinstance(item, NoulItem):
        pred = item.verdict
    elif isinstance(item, ScoreItem):
        if not 0 <= item.level < len(q["criteria"]):
            return None
        pred = item.level
    else:
        if item.choice not in q["criteria"]:
            return None
        pred = item.choice

    evidence = verify_evidence(answer, item.evidence)
    if len(evidence) < len(item.evidence):
        logger.warning("dropped %d unverified quote(s) for %s", len(item.evidence) - len(evidence), item.question_id)
    return Judgment(item.question_id, item.type, pred=pred, evidence=evidence, reasoning=item.reasoning)


class GeminiJudge:
    """LLM judge. Retries questions with invalid output once; still-invalid ones get pred=None."""

    def __init__(
        self,
        client: genai.Client | None = None,
        model: str = DEFAULT_MODEL,
        thinking_level: str | None = None,  # "minimal" | "low" | "medium" | "high"; None = model default
        max_attempts: int = 2,
    ):
        self.client = client or genai.Client()
        self.model = model
        self.thinking_level = thinking_level
        self.max_attempts = max_attempts
        self.last_usage: dict[str, int] = {}
        self.last_latency: float = 0.0

    def _call(self, problem: str, answer: str, questions: Questions):
        kwargs = {}
        if self.thinking_level:
            kwargs["generation_config"] = {"thinking_level": self.thinking_level}
        t0 = time.perf_counter()
        interaction = self.client.interactions.create(
            model=self.model,
            system_instruction=SYSTEM,
            input=build_prompt(problem, answer, questions),
            response_format={"type": "text", "mime_type": "application/json", "schema": GeminiResult.model_json_schema()},
            store=False,
            **kwargs,
        )
        self.last_latency += time.perf_counter() - t0
        u = interaction.usage
        for key, attr in [("input_tokens", "total_input_tokens"), ("output_tokens", "total_output_tokens"), ("thought_tokens", "total_thought_tokens")]:
            self.last_usage[key] = self.last_usage.get(key, 0) + (getattr(u, attr, None) or 0)
        return interaction

    def evaluate(self, problem: str, answer: str, questions: Questions) -> list[Judgment]:
        self.last_usage, self.last_latency = {}, 0.0
        results: dict[str, Judgment] = {}
        pending = dict(questions)

        for _ in range(self.max_attempts):
            if not pending:
                break
            interaction = self._call(problem, answer, pending)
            try:
                items = GeminiResult.model_validate_json(interaction.output_text).items
            except ValidationError as e:
                logger.warning("invalid Gemini output, retrying %d question(s): %s", len(pending), e)
                continue
            for item in items:
                q = pending.get(item.question_id)
                if q is None or item.question_id in results:
                    continue
                j = _to_judgment(item, q, answer)
                if j is not None:
                    results[item.question_id] = j
            pending = {qid: q for qid, q in pending.items() if qid not in results}

        for qid, q in pending.items():
            logger.warning("no valid Gemini judgment for %s", qid)
            results[qid] = Judgment(qid, q["type"], pred=None)
        return [results[qid] for qid in questions]
