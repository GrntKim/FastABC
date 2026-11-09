"""API request and response schemas."""

from datetime import datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.judges.base import GATE
from app.models import ItemKind, ItemType


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


class SignupIn(BaseModel):
    email: str = Field(max_length=254, pattern=r"^[^@\s]+@[^@\s]+\.[^@\s]+$")
    name: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8, max_length=200)

    @model_validator(mode="after")
    def normalize(self) -> Self:
        self.email = self.email.strip().lower()
        self.name = self.name.strip()
        if not self.name:
            raise ValueError("name must not be blank")
        return self


class LoginIn(BaseModel):
    email: str = Field(max_length=254)
    password: str = Field(max_length=200)


class UserOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    email: str
    name: str


class CourseIn(BaseModel):
    department: str = Field(min_length=1, max_length=100)
    term: str = Field(min_length=1, max_length=20)  # e.g. "2026-2"
    name: str = Field(min_length=1, max_length=200)
    section: str = Field(min_length=1, max_length=20)


class CourseRef(CourseIn):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ProgressOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    stage: str  # setup / grading / review / done / finalized
    submissions: int
    cells: int
    decided: int
    pending: int
    attention: int  # undecided cells a person must look at
    students_done: int  # submissions with every cell confirmed


class AssignmentIn(BaseModel):
    course_id: int
    assessment: str | None = Field(default=None, max_length=100)  # e.g. "중간고사 2번"
    title: str = Field(min_length=1, max_length=200)
    problem: str = Field(min_length=1)
    items: list[RubricItemIn] = Field(min_length=2)

    @model_validator(mode="after")
    def check_items(self) -> Self:
        keys = [item.key for item in self.items]
        if len(keys) != len(set(keys)):
            raise ValueError("item keys must be unique")
        if sum(item.kind == ItemKind.GATE for item in self.items) != 1:
            raise ValueError(f"exactly one gate item ('{GATE}') is required")
        return self


class RubricItemOut(RubricItemIn):
    model_config = ConfigDict(from_attributes=True)

    id: int
    position: int


class AssignmentSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    assessment: str | None
    title: str
    judge_model: str
    created_at: datetime
    max_points: float
    submission_count: int
    progress: ProgressOut


class AssignmentOut(AssignmentSummary):
    course: CourseRef
    problem: str
    items: list[RubricItemOut]


class CourseSummary(CourseRef):
    created_at: datetime
    assignment_count: int
    submission_count: int  # summed over assignments
    attention: int  # cells to look at, over all assignments
    stages: dict[str, int]  # stage -> assignment count


class CourseOut(CourseSummary):
    assignments: list[AssignmentSummary]


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    student_ref: str
    source_filename: str | None
    extraction_status: str
    clean_text: str
    created_at: datetime


class GradingStatus(BaseModel):
    total: int  # cells (submission x rubric item)
    pending: int  # waiting for the LLM re-judgment
    done: bool
    routes: dict[str, int]  # route -> cell count


class JudgeView(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    model: str
    pred: Any
    conf: float | None
    evidence: list[str]
    reasoning: str | None


class CellOut(BaseModel):
    """One submission x rubric item, as shown in the review UI."""

    grade_id: int
    submission_id: int
    label: str
    answer: str  # clean_text
    rubric_item_id: int
    item_key: str
    route: str
    sampled: bool  # auto cell picked for a manual look: excluded from bulk accept
    recommended_pred: Any
    recommended_points: float | None
    final_points: float | None
    decision: str | None
    decided_at: datetime | None
    primary: JudgeView | None  # decision model
    secondary: JudgeView | None  # LLM re-judgment; also shown for the human route, as reference only
    evidence: JudgeView | None  # on-demand evidence lookup for cells that were not escalated


class GradeDecisionIn(BaseModel):
    action: Literal["accept", "set", "clear"]
    points: float | None = None  # required for "set"

    @model_validator(mode="after")
    def check_points(self) -> Self:
        if (self.action == "set") != (self.points is not None):
            raise ValueError("points is required for 'set' and only for 'set'")
        return self


class BulkAcceptOut(BaseModel):
    accepted: int


class BulkClearOut(BaseModel):
    cleared: int


class FinalizeIn(BaseModel):
    # the signer is the logged-in grader
    confirmed: Literal[True]  # "I checked every cell and take responsibility for these grades"


class ReopenIn(BaseModel):
    reason: str = Field(min_length=1, max_length=1000)

    @model_validator(mode="after")
    def strip_reason(self) -> Self:
        self.reason = self.reason.strip()
        if not self.reason:
            raise ValueError("reason must not be blank")
        return self


class FinalizationOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    version: int
    finalized_by: str
    finalized_at: datetime
    counts: dict[str, int]  # decision -> cells
    snapshot_hash: str
    reopened_at: datetime | None
    reopen_reason: str | None


class EvidenceOut(BaseModel):
    requested: int  # cells sent to the LLM in this call (0 when every cell already had evidence)


class SubmissionResult(BaseModel):
    submission_id: int
    label: str
    student_ref: str
    decided: int
    cells: int
    total: float | None  # None until every cell is decided
    max_points: float


class RubricDraftIn(BaseModel):
    problem: str = Field(min_length=1)
    rubric_text: str = Field(min_length=1, max_length=5000)  # the grader's own wording, e.g. "연쇄법칙 언급 2점 …"


class RubricDraftOut(BaseModel):
    items: list[dict[str, Any]]  # RubricItemIn-shaped, unvalidated: the grader edits them before saving
    warnings: list[str]  # adjustments made while converting
    problems: list[str]  # validation messages to fix before saving ("2번 항목: …")
