from sqlalchemy.orm import Session
from app.problems.models import Problem
from app.finalization import latest
from app.scoring import total
from app.courses.models import Exam
from app.scoring import max_total

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


def exam_results(db: Session, exam: Exam):
    problems = exam.problems
    scores = {}
    names = {s.student_ref: s.student_name for p in exam.problems for s in p.submissions}

    for p in problems:
        _, rows, _, _, _ = results(db, p)
        for s, _, total_points in rows:
            scores.setdefault(s.student_ref, {})[p.id] = total_points

    exam_rows = []
    for ref in sorted(scores):
        cells = []
        for p in problems:
            submitted = p.id in scores[ref]
            points = scores[ref][p.id] if submitted else 0
            cells.append((submitted, points))
        exam_total = None if any(sub and pts is None for sub, pts in cells) else sum(pts for _, pts in cells)
        exam_rows.append((ref, names.get(ref), cells, exam_total))

    max_points = sum(max_total(p.criteria) for p in problems)
    return problems, exam_rows, max_points
