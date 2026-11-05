"""Turn a grader's plain-language rubric into rubric items (judge questions). Vendor-neutral.

The LLM fills a flat schema (`RubricDraft`); `to_items` converts it into the API's item format.
The grader reviews and edits the result before saving, so nothing here is final.
"""

import re
from typing import Literal, Protocol

from pydantic import BaseModel

from app.judges.base import GATE


class DraftTopic(BaseModel):
    instructions: str  # proposition: "`answer`가 `question`의 주제인 …을 설명하려고 시도한다."
    criteria_true: str
    criteria_false: str


class DraftItem(BaseModel):
    key: str  # snake_case English
    label: str  # short Korean name for graders
    type: Literal["noul", "score"]
    kind: Literal["credit", "deduction"]
    instructions: str
    criteria_true: str  # noul only ("" otherwise)
    criteria_false: str  # noul only
    levels: list[str]  # score only: level descriptions from 0 (lowest) up
    level_points: list[float]  # score only: points per level, same length as levels
    points: float  # noul only: credit or deduction amount


class RubricDraft(BaseModel):
    topic: DraftTopic
    items: list[DraftItem]


class RubricDrafter(Protocol):
    def draft(self, problem: str, rubric_text: str) -> RubricDraft: ...


def _key(raw: str, taken: set[str]) -> str:
    key = re.sub(r"[^a-z0-9_]+", "_", raw.lower()).strip("_")[:40] or "item"
    if not key[0].isalpha():
        key = f"item_{key}"
    base, n = key, 2
    while key in taken or key == GATE:
        key, n = f"{base}_{n}", n + 1
    taken.add(key)
    return key


def _fmt(x: float) -> float | int:
    return int(x) if float(x).is_integer() else x


def to_items(draft: RubricDraft) -> tuple[list[dict], list[str]]:
    """API-shaped rubric items (gate first) and warnings about anything that was adjusted."""
    warnings: list[str] = []
    items: list[dict] = [{
        "key": GATE,
        "label": "주제 관련성",
        "type": "noul",
        "kind": "gate",
        "instructions": draft.topic.instructions,
        "criteria": {"true": draft.topic.criteria_true, "false": draft.topic.criteria_false},
    }]
    taken: set[str] = set()
    for d in draft.items:
        item = {"key": _key(d.key, taken), "label": d.label.strip() or None, "instructions": d.instructions}
        if d.type == "score":
            if d.kind == "deduction":
                warnings.append(f"'{d.label}': 감점 항목은 예/아니오 형식만 가능해 가점으로 바꿨습니다")
            levels = d.levels[:10]
            if len(levels) < 2:
                warnings.append(f"'{d.label}': 수준이 2개 미만이라 예/아니오 항목으로 바꿨습니다")
                item |= {"type": "noul", "kind": "credit", "points": _fmt(max(d.level_points, default=1) or 1)}
            else:
                points = (d.level_points + list(range(len(d.level_points), len(levels))))[: len(levels)]
                if len(d.level_points) != len(levels):
                    warnings.append(f"'{d.label}': 수준별 점수 개수가 맞지 않아 빈 수준은 수준 번호로 채웠습니다")
                item |= {
                    "type": "score",
                    "kind": "credit",
                    "criteria": levels,
                    "points_map": {str(i): _fmt(p) for i, p in enumerate(points)},
                }
        else:
            points = d.points if d.points > 0 else 1
            if d.points <= 0:
                warnings.append(f"'{d.label}': 배점이 없어 1점으로 정했습니다")
            criteria = {"true": d.criteria_true, "false": d.criteria_false} if d.criteria_true and d.criteria_false else None
            item |= {"type": "noul", "kind": d.kind, "points": _fmt(points), "criteria": criteria}
        items.append(item)
    return items, warnings
