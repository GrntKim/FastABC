from sqlalchemy.orm import Session
from app.problems.models import Problem
from app.finalization import latest
from app.scoring import total

def results(db: Session, problem: Problem):
    result_criteria = [c for c in problem.criteria if c.kind != "gate"]
    subs = sorted(problem.submissions, key=lambda s: s.label)
    rows = []
    for s in subs:
        by_criterion = {g.criterion_id: g for g in s.grades}
        points = []
        for c in result_criteria:
            g = by_criterion.get(c.id)
            points.append(g.final_points if g else None)

        total_points = total(points)

        rows.append((s, points, total_points))

    counts = {"accepted": 0, "modified": 0, "manual": 0}
    undecided = 0
    for s in subs:
        for g in s.grades:
            if g.decision is None:
                undecided += 1
            else:
                counts[g.decision] += 1

    signoff = latest(db, problem.id)
    return result_criteria, rows, counts, undecided, signoff
