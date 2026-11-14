"""Clear an exam's answers so the booth demo (CSV upload → grade → review → sign off) can run again.

    uv run python scripts/booth_reset.py --exam 5          # show what would go
    uv run python scripts/booth_reset.py --exam 5 --yes    # delete it

Every answer of every problem in the exam goes, and with it (by the database's cascades) its judgments
and grades; the problems' sign-offs go too, so the next run can sign off as version 1 again.
Problems and their criteria stay.
"""

import argparse

from sqlalchemy import delete, func, select

import app.models  # noqa: F401  registers every model
from app.core.db import SessionLocal
from app.models import Exam, Finalization, Submission


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--exam", type=int, required=True, help="exam id, as in /exams/<id>")
    parser.add_argument("--yes", action="store_true", help="delete; without it, only show what would go")
    args = parser.parse_args()

    with SessionLocal() as db:
        exam = db.get(Exam, args.exam)
        if exam is None:
            raise SystemExit(f"no exam {args.exam}")
        ids = [p.id for p in exam.problems]
        answers = db.scalar(select(func.count()).where(Submission.problem_id.in_(ids)))
        signoffs = db.scalar(select(func.count()).where(Finalization.problem_id.in_(ids)))
        print(f"{exam.course.name} · {exam.name}: {len(ids)} problems, {answers} answers, {signoffs} sign-offs")
        if not args.yes:
            print("dry run: add --yes to delete")
            return
        db.execute(delete(Finalization).where(Finalization.problem_id.in_(ids)))
        db.execute(delete(Submission).where(Submission.problem_id.in_(ids)))
        db.commit()
        print("cleared")


if __name__ == "__main__":
    main()
