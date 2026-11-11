"""Clear the answers added at the booth, so the paper-to-grade demo can run again.

    uv run python scripts/booth_reset.py --exam 1             # list what would go, in every question of the exam
    uv run python scripts/booth_reset.py --exam 1 --yes       # delete it
    uv run python scripts/booth_reset.py --assignment 10      # one question only

Only answers that came from a file (answer sheet PDFs, photos, camera shots: they keep a file name)
are removed, with their judgments and grades. CSV uploads stay. A signed-off question is left alone.
"""

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Assignment, Exam, Finalization, Submission


def reset(db, assignment: Assignment, delete: bool) -> None:
    signed = db.scalar(
        select(Finalization.id).where(Finalization.assignment_id == assignment.id, Finalization.reopened_at.is_(None))
    )
    if signed is not None:
        print(f"{assignment.title}: signed off, left alone (reopen it first, or use a demo question)")
        return
    booth = db.scalars(
        select(Submission).where(Submission.assignment_id == assignment.id, Submission.source_filename.is_not(None))
    ).all()
    print(f"{assignment.title}: {len(booth)} answer(s) from files")
    for s in booth:
        print(f"  {s.label} {s.student_ref} {s.student_name or ''} ({s.source_filename})")
    if delete:
        for s in booth:
            db.delete(s)  # judgments and grades go with it


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    target = parser.add_mutually_exclusive_group(required=True)
    target.add_argument("--exam", type=int, help="every question of this exam")
    target.add_argument("--assignment", type=int, help="one question")
    parser.add_argument("--yes", action="store_true", help="delete; without it, only list")
    args = parser.parse_args()

    with SessionLocal() as db:
        if args.exam is not None:
            exam = db.get(Exam, args.exam)
            if exam is None:
                raise SystemExit(f"no exam {args.exam}")
            questions = sorted(exam.assignments, key=lambda a: a.number or 0)
        else:
            assignment = db.get(Assignment, args.assignment)
            if assignment is None:
                raise SystemExit(f"no assignment {args.assignment}")
            questions = [assignment]
        for assignment in questions:
            reset(db, assignment, args.yes)
        if args.yes:
            db.commit()
            print("deleted")
        else:
            print("add --yes to delete")


if __name__ == "__main__":
    main()
