from typing import Any, Self

from pydantic import BaseModel, Field, model_validator

from app.judges.base import GATE
from app.models import ItemKind, ItemType

# year, then the session: 1 and 2 are the semesters, 1S and 2W the summer and winter sessions.
# Sorting the codes as text puts them in calendar order.
TERM_PATTERN = r"^\d{4}-(1|1S|2|2W)$"

class RubricItemIn(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_]{0,99}$")  # judge question id
    label: str | None = Field(default=None, max_length=100)  # display name for graders
    type: ItemType
    instructions: str = Field(min_length=1)
    criteria: Any = None  # noul {"true", "false"} (optional) / score [level descriptions] / choice {name: description}
    kind: ItemKind
    points: float | None = Field(default=None, gt=0)
    points_map: dict[str, float] | None = None

    @model_validator(mode="after")
    def check_criteria_and_scoring(self) -> Self:
        if self.type == ItemType.NOUL:
            if self.criteria is not None and (
                not isinstance(self.criteria, dict) or set(self.criteria) != {"true", "false"}
            ):
                raise ValueError("noul criteria must be {'true': ..., 'false': ...} or omitted")
        elif self.type == ItemType.SCORE:
            if not isinstance(self.criteria, list) or not 2 <= len(self.criteria) <= 10:
                raise ValueError("score criteria must be a list of 2-10 level descriptions")
        elif not isinstance(self.criteria, dict) or len(self.criteria) < 2:
            raise ValueError("choice criteria must map at least 2 choice names to descriptions")

        if self.kind == ItemKind.GATE:
            if self.key != GATE or self.type != ItemType.NOUL:
                raise ValueError(f"the gate item must be a noul question with key '{GATE}'")
            if self.points is not None or self.points_map is not None:
                raise ValueError("the gate item has no points")
        elif self.key == GATE:
            raise ValueError(f"'{GATE}' is reserved for the gate item")
        elif self.kind == ItemKind.DEDUCTION or self.type == ItemType.NOUL:
            if self.type != ItemType.NOUL:
                raise ValueError("deduction items must be noul questions")
            if self.points is None or self.points_map is not None:
                raise ValueError("noul items need points and no points_map")
        else:
            expected = {str(i) for i in range(len(self.criteria))} if self.type == ItemType.SCORE else set(self.criteria)
            if self.points is not None or self.points_map is None or set(self.points_map) != expected:
                raise ValueError(f"{self.type} items need points_map with keys {sorted(expected)} and no points")
        return self
