"""Grading progress per problem: what the grader still has to do."""

from dataclasses import dataclass
from enum import StrEnum

from sqlalchemy import case, func, or_, select
from sqlalchemy.orm import Session

from app.models import Finalization, Grade, GradeRoute, Submission


class Stage(StrEnum):
    SETUP = "setup"  # not graded yet
    GRADING = "grading"  # LLM re-judgment still running
    REVIEW = "review"  # some cells not confirmed
    DONE = "done"  # every cell confirmed
    FINALIZED = "finalized"  # signed off and locked


@dataclass
class Progress:
    submissions: int = 0
    cells: int = 0
    decided: int = 0
    pending: int = 0
    attention: int = 0  # undecided cells a person must look at: human, llm, or sampled
    students_done: int = 0  # submissions with every cell confirmed
    graded_submissions: int = 0  # submissions with at least one cell
    finalized: bool = False

    @property
    def stage(self) -> Stage:
        if self.finalized:
            return Stage.FINALIZED
        if self.cells == 0:
            return Stage.SETUP
        if self.pending:
            return Stage.GRADING
        if self.decided < self.cells or self.graded_submissions < self.submissions:
            return Stage.REVIEW  # an answer added later still waits to be graded
        return Stage.DONE


def progress(db: Session, problem_ids: list[int]) -> dict[int, Progress]:
    """One aggregate query for many problems; unknown or empty ids get an empty Progress."""
    result = {aid: Progress() for aid in problem_ids}
    if not problem_ids:
        return result

    for aid, count in db.execute(
        select(Submission.problem_id, func.count())
        .where(Submission.problem_id.in_(problem_ids))
        .group_by(Submission.problem_id)
    ):
        result[aid].submissions = count

    undecided = Grade.decision.is_(None)
    needs_look = or_(Grade.route.in_([GradeRoute.HUMAN, GradeRoute.LLM]), Grade.sampled)
    rows = db.execute(
        select(
            Submission.problem_id,
            func.count(Grade.id),
            func.count(Grade.decision),
            func.sum(case((Grade.route == GradeRoute.PENDING, 1), else_=0)),
            func.sum(case((undecided & needs_look, 1), else_=0)),
        )
        .join(Submission, Grade.submission_id == Submission.id)
        .where(Submission.problem_id.in_(problem_ids))
        .group_by(Submission.problem_id)
    )
    for aid, cells, decided, pending, attention in rows:
        p = result[aid]
        p.cells, p.decided, p.pending, p.attention = cells, decided, pending or 0, attention or 0

    for aid, count in db.execute(
        select(Submission.problem_id, func.count(func.distinct(Grade.submission_id)))
        .join(Grade, Grade.submission_id == Submission.id)
        .where(Submission.problem_id.in_(problem_ids))
        .group_by(Submission.problem_id)
    ):
        result[aid].graded_submissions = count

    finished = (
        select(Submission.problem_id)
        .join(Grade, Grade.submission_id == Submission.id)
        .where(Submission.problem_id.in_(problem_ids))
        .group_by(Submission.problem_id, Submission.id)
        .having(func.count(Grade.id) == func.count(Grade.decision))
        .subquery()
    )
    for aid, count in db.execute(select(finished.c.problem_id, func.count()).group_by(finished.c.problem_id)):
        result[aid].students_done = count

    # only the latest version can be open: a new one needs the previous one reopened
    for aid in db.scalars(
        select(Finalization.problem_id).where(
            Finalization.problem_id.in_(problem_ids), Finalization.reopened_at.is_(None)
        )
    ):
        result[aid].finalized = True
    return result
