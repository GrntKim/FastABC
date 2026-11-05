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

from app.drafting import RubricDraft
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


def _compact(s: str) -> str:
    # PDF extraction loses whether a line break was a space ("갱신\n하는" vs "갱신하는"), so ignore all whitespace
    return "".join(s.split()).strip(".,\"'“”‘’")


def verify_evidence(answer: str, quotes: list[str]) -> list[str]:
    """Keep only quotes that appear verbatim (ignoring whitespace) in the answer."""
    text = _compact(answer)
    return [q for q in quotes if _compact(q) and _compact(q) in text]


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


DRAFT_SYSTEM = """당신은 대학 서술형 채점 기준 설계 보조자입니다. 채점자가 평소 쓰는 채점 기준 문장을, 판단 모델이 답안 하나에 대해 판단할 질문 목록으로 바꿉니다.

규칙:
- 채점 기준 문장에 있는 항목만 만든다. 없는 항목을 지어내지 않는다.
- topic: 답안이 문제의 주제를 다루려고 시도하는지 묻는 명제. "`answer`가 `question`의 주제인 …을(를) 설명하려고 시도한다." 형태.
- 언급 여부·포함 여부처럼 예/아니오로 답할 항목은 type "noul". instructions는 "`answer`가 …한다." 형태의 명제 하나.
- 정확도·완성도처럼 수준으로 매기는 항목은 type "score". instructions는 "`answer`의 …은(는) 얼마나 …한가?" 형태. levels는 가장 낮은 수준(0)부터 높은 순서, 수준마다 구체적인 설명. level_points는 수준별 점수.
- 오개념·오류처럼 해당하면 깎는 항목은 kind "deduction", type "noul". 오개념마다 항목 하나. instructions는 "`answer`가 …라고 주장한다." 형태.
- 나머지는 kind "credit".
- noul 항목의 criteria_true / criteria_false: 참·거짓으로 볼 기준을 한 문장씩. points: 배점(감점 항목은 깎는 점수, 양수).
- score 항목은 criteria_true, criteria_false를 ""로, points를 0으로 둔다. noul 항목은 levels, level_points를 빈 배열로 둔다.
- 배점이 문장에 없으면 noul은 1점, score는 수준 번호를 점수로 쓴다.
- key: 영어 snake_case, 40자 이내, 항목마다 다르게. label: 채점자가 볼 짧은 한국어 이름(20자 이내). 감점 항목 label은 "오개념: …" 형태.
- 문장은 한국어로 쓴다. 문제에 나온 전문 용어는 그대로 쓴다."""

DRAFT_EXAMPLE = """## 예시
문제: 신경망 학습에서 역전파(backpropagation)가 어떻게 동작하는지 설명하시오.
채점 기준: 연쇄법칙 언급 2점, 설명 정확도 0~4점(완전하면 4), 오개념(역전파를 최적화 알고리즘으로 봄) 1점 감점
결과(요약):
- topic: "`answer`가 `question`의 주제인 역전파를 설명하려고 시도한다."
- mentions_chain_rule / 연쇄법칙 언급 / noul / credit / "`answer`가 역전파는 연쇄법칙을 이용해 기울기를 계산한다고 설명한다." / points 2
- accuracy / 설명 정확도 / score / credit / "`answer`의 역전파 동작 원리 설명은 얼마나 정확한가?" / levels 4개(전혀 설명 없음 → 정확하고 완전함) / level_points [0, 1, 2, 4]
- misc_is_optimizer / 오개념: 역전파를 최적화 알고리즘으로 봄 / noul / deduction / "`answer`가 역전파 자체를 가중치를 갱신하는 최적화 알고리즘이라고 주장한다." / points 1"""


class GeminiRubricDrafter:
    """Plain-language rubric -> RubricDraft, one structured-output call."""

    def __init__(self, client: genai.Client | None = None, model: str = DEFAULT_MODEL):
        self.client = client or genai.Client()
        self.model = model

    def draft(self, problem: str, rubric_text: str) -> RubricDraft:
        interaction = self.client.interactions.create(
            model=self.model,
            system_instruction=DRAFT_SYSTEM,
            input=f"{DRAFT_EXAMPLE}\n\n## 문제\n{problem}\n\n## 채점 기준\n{rubric_text}",
            response_format={"type": "text", "mime_type": "application/json", "schema": RubricDraft.model_json_schema()},
            store=False,
        )
        return RubricDraft.model_validate_json(interaction.output_text)
