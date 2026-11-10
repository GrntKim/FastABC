"""Clear the answers added at the booth, so the paper-to-grade demo can run again.

    uv run python scripts/booth_reset.py --assignment 10          # list what would go
    uv run python scripts/booth_reset.py --assignment 10 --yes    # delete it

Only answers added one at a time (from a PDF, a photo, or the webcam: they keep a file name)
are removed, with their judgments and grades. CSV uploads stay. A signed-off question is left alone.
"""

import argparse

from sqlalchemy import select

from app.db import SessionLocal
from app.models import Assignment, Finalization, Submission


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--assignment", type=int, required=True)
    parser.add_argument("--yes", action="store_true", help="delete; without it, only list")
    args = parser.parse_args()

    with SessionLocal() as db:
        assignment = db.get(Assignment, args.assignment)
        if assignment is None:
            raise SystemExit(f"no assignment {args.assignment}")
        signed = db.scalar(
            select(Finalization.id).where(Finalization.assignment_id == assignment.id, Finalization.reopened_at.is_(None))
        )
        if signed is not None:
            raise SystemExit(f"assignment {assignment.id} is signed off: reopen it first, or use a demo question")
        booth = db.scalars(
            select(Submission).where(Submission.assignment_id == assignment.id, Submission.source_filename.is_not(None))
        ).all()
        print(f"{assignment.title}: {len(booth)} answer(s) added one at a time")
        for s in booth:
            print(f"  {s.label} {s.student_ref} {s.student_name or ''} ({s.source_filename})")
        if booth and args.yes:
            for s in booth:
                db.delete(s)  # judgments and grades go with it
            db.commit()
            print("deleted")
        elif booth:
            print("add --yes to delete")


if __name__ == "__main__":
    main()
