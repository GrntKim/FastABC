from sqlalchemy.orm import Session
from app.problems.models import Criterion
from app.grading.models import Grade, Decision
from app.finalization import ensure_unlocked
from datetime import datetime, UTC
from app.submissions.models import Submission


def bulk_target(g) -> bool:
    return g.decision is None and g.route in ("auto", "skip") and not g.sampled

def point_options(criterion: Criterion) -> list[float]:
    if criterion.kind == "deduction":
        return [-criterion.points, 0.0]
    elif criterion.type == "noul":
        return [0.0, criterion.points]
    else:
        return sorted(set(criterion.points_map.values()))


def decide(db: Session, criterion: Criterion, grade: Grade, points: float | None):
    ensure_unlocked(db, criterion.problem_id)

    if grade.route == "pending":
        raise ValueError("재판단을 기다리는 중입니다.")
    if points is None:
        grade.final_points, grade.decision, grade.decided_at = None, None, None
        db.commit()
        return
    if points not in point_options(criterion):
        raise ValueError("이 항목에 줄 수 없는 점수입니다.")

    if grade.recommended_points is None:
        decision = Decision.MANUAL
    elif points == grade.recommended_points:
        decision = Decision.ACCEPTED
    else:
        decision = Decision.MODIFIED
    
    grade.final_points, grade.decision, grade.decided_at = points, decision, datetime.now(UTC)
    db.commit()


def accept_confident(db: Session, submission: Submission) -> int:
    criteria_dict = {c.id: c for c in submission.problem.criteria}

    num = 0
    for g in submission.grades:
        if not bulk_target(g):
            continue
        decide(db, criteria_dict[g.criterion_id], g, g.recommended_points)
        num += 1

    return num

    