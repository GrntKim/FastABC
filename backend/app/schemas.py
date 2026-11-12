"""API request and response schemas."""

from datetime import date, datetime
from typing import Any, Literal, Self

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

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




class CourseIn(BaseModel):
    department: str = Field(min_length=1, max_length=100)
    # year and session: 1, 1S (summer session), 2, 2W (winter session); sorts in calendar order as text
    term: str = Field(pattern=TERM_PATTERN)
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
    exam_id: int | None = None  # an exam of the same course
    number: int | None = Field(default=None, ge=1, le=99)  # question number within the exam
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
    exam_id: int | None
    exam_name: str | None
    number: int | None
    assessment: str | None  # exam and number as graders say it, e.g. "중간고사 2번"
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


class CourseGroup(BaseModel):
    """A course's questions under one exam, for the course list: which exam period, and how far along."""

    exam_id: int | None  # None: questions outside any exam
    name: str | None
    period: Literal["midterm", "final", "other"]
    assignment_count: int
    attention: int
    stages: dict[str, int]  # stage -> assignment count


class CourseSummary(CourseRef):
    created_at: datetime
    assignment_count: int
    submission_count: int  # summed over assignments
    attention: int  # cells to look at, over all assignments
    stages: dict[str, int]  # stage -> assignment count
    groups: list[CourseGroup]  # per exam in the order they were added, questions outside an exam last


class ExamIn(BaseModel):
    name: str = Field(min_length=1, max_length=100)

    @field_validator("name")
    @classmethod
    def strip_name(cls, v: str) -> str:
        if not v.strip():
            raise ValueError("name is empty")
        return v.strip()


class ExamRef(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    course_id: int
    name: str


class CourseOut(CourseSummary):
    assignments: list[AssignmentSummary]
    exams: list[ExamRef]


class ExamColumn(BaseModel):
    """One column of an exam's results: a question graded here, or points imported from elsewhere."""

    kind: Literal["question", "imported"]
    id: int  # assignment id or imported part id
    title: str
    number: int | None
    max_points: float
    stage: str | None  # questions only: setup / grading / review / done / finalized


class ExamCell(BaseModel):
    points: float | None  # None: not decided yet, or no answer
    submitted: bool  # False: this student has no answer (or no imported score) for the column
    submission_id: int | None = None  # questions only: the answer, to open it for grading


class ExamStudent(BaseModel):
    student_ref: str
    student_name: str | None
    cells: list[ExamCell]
    total: float | None  # None while any submitted answer is undecided; missing answers count as 0


class ExamResults(BaseModel):
    exam: ExamRef
    course: CourseRef
    columns: list[ExamColumn]
    students: list[ExamStudent]
    max_points: float
    finalized: bool  # every question signed off


class SubmissionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    label: str
    student_ref: str
    student_name: str | None
    source_filename: str | None
    extraction_status: str
    clean_text: str
    created_at: datetime


class SubmissionIn(BaseModel):
    """One answer typed in or read from a PDF or picture, after the grader checked the text."""

    student_id: str = Field(min_length=1, max_length=100)
    name: str | None = Field(default=None, max_length=100)
    answer: str = Field(min_length=1)
    source_filename: str | None = Field(default=None, max_length=255)


class ReadingOut(BaseModel):
    text: str
    method: Literal["text", "ai"]  # taken from the PDF's own text, or transcribed by the LLM


class ExamAnswerOut(BaseModel):
    assignment_id: int
    number: int
    title: str
    text: str  # empty: nothing found for this question on the sheet
    locked: bool  # the question's grades are signed off: an answer cannot be added


class ExamCsvQuestion(BaseModel):
    assignment_id: int
    number: int
    created: int  # answers added to this question


class ExamCsvOut(BaseModel):
    """What a whole-exam CSV added. Skipped cells are not errors, so a sheet can be sent again with more rows."""

    questions: list[ExamCsvQuestion]  # every question with a column in the CSV that is not signed off
    skipped_existing: int  # cells of students who already had an answer for that question
    locked: list[int]  # numbers of signed-off questions whose column was left alone
    ignored_columns: list[str]  # columns that are neither 학번, 이름 nor a question of this exam


class ExamReadingOut(BaseModel):
    """One student's whole answer sheet, split by question. Nothing is saved."""

    method: Literal["text", "ai"]
    answers: list[ExamAnswerOut]  # every numbered question of the exam, in order
    rest: str  # text before the first question number (a header, or a sheet with no numbers at all)


class GradingStatus(BaseModel):
    total: int  # cells (submission x rubric item)
    pending: int  # waiting for the LLM re-judgment
    done: bool
    routes: dict[str, int]  # route -> cell count
    ungraded: int  # answers added after grading started, not judged yet


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
    student_ref: str
    student_name: str | None
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
    late_ok: bool = False  # "grades are past due for this term; sign off anyway"


class TermScheduleIn(BaseModel):
    midterm_due: date | None = None  # None: midterm questions are not checked
    final_due: date | None = None


class TermScheduleOut(TermScheduleIn):
    term: str


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
    late: bool  # signed off after the term's grades were due
    reopened_at: datetime | None
    reopen_reason: str | None


class ReportItem(BaseModel):
    rubric_item_id: int
    points: float | None  # what the grader confirmed
    by_grader: bool  # the grader set the points rather than taking the recommendation
    quotes: list[str]  # the answer's words behind the points, only where a judge reached the same points


class StudentReport(BaseModel):
    """One student's answer to a signed-off question, item by item: what goes back to the student."""

    submission_id: int
    student_ref: str
    student_name: str | None
    answer: str  # as graded (identifiers removed), so quotes can be marked in it
    off_topic: bool  # judged unrelated to the question: every item 0
    total: float | None
    items: list[ReportItem]  # rubric order, the topic check left out


class AssignmentReport(BaseModel):
    finalization: FinalizationOut  # the sign-off the report stands on
    max_points: float
    students: list[StudentReport]


class EvidenceOut(BaseModel):
    requested: int  # cells sent to the LLM in this call (0 when every cell already had evidence)


class SubmissionResult(BaseModel):
    submission_id: int
    label: str
    student_ref: str
    student_name: str | None
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
