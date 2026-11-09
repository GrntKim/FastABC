"""Student answers: upload (CSV for now), list, delete."""

import csv
import io

from fastapi import APIRouter, Depends, HTTPException, UploadFile, status
from sqlalchemy import exists, select
from sqlalchemy.orm import Session

from app.auth import current_user, own_assignment, own_submission
from app.db import get_db
from app.finalization import ensure_unlocked
from app.models import ExtractionStatus, Grade, Submission, User
from app.redact import redact
from app.schemas import SubmissionOut

router = APIRouter(tags=["submissions"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024
REQUIRED_COLUMNS = {"student_id", "answer"}
# Korean headers as LMS exports and hand-made sheets usually have them
COLUMN_ALIASES = {"학번": "student_id", "답안": "answer", "이름": "name", "성명": "name"}


def _decode(data: bytes) -> str:
    # Excel saves Korean CSV as cp949 unless "CSV UTF-8" is chosen
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV must be UTF-8 or CP949 encoded")


def _parse_csv(text: str) -> list[dict[str, str]]:
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV is empty")
    names = [name.strip().lower() for name in reader.fieldnames]
    reader.fieldnames = [COLUMN_ALIASES.get(name, name) for name in names]
    missing = REQUIRED_COLUMNS - set(reader.fieldnames)
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"missing columns: {sorted(missing)}")

    rows, seen = [], set()
    for line, row in enumerate(reader, start=2):
        student_id = (row.get("student_id") or "").strip()
        if not student_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"line {line}: student_id is empty")
        if student_id in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"line {line}: duplicate student_id {student_id}")
        seen.add(student_id)
        rows.append({"student_id": student_id, "answer": row.get("answer") or "", "name": row.get("name")})
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV has no rows")
    return rows


def _next_label_number(db: Session, assignment_id: int) -> int:
    labels = db.scalars(select(Submission.label).where(Submission.assignment_id == assignment_id))
    return max((int(label[1:]) for label in labels), default=0) + 1


@router.post("/assignments/{assignment_id}/submissions/csv", status_code=status.HTTP_201_CREATED)
def upload_csv(
    assignment_id: int, file: UploadFile, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[SubmissionOut]:
    """Columns: student_id, answer, optional name (used only for redaction, not stored)."""
    own_assignment(db, user, assignment_id)
    ensure_unlocked(db, assignment_id)  # a new answer would change finalized results
    data = file.file.read(MAX_UPLOAD_BYTES + 1)  # sync route: runs in the threadpool like the DB calls
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "CSV is larger than 5 MB")
    rows = _parse_csv(_decode(data))

    existing = set(db.scalars(
        select(Submission.student_ref).where(
            Submission.assignment_id == assignment_id,
            Submission.student_ref.in_([r["student_id"] for r in rows]),
        )
    ))
    if existing:
        raise HTTPException(status.HTTP_409_CONFLICT, f"already uploaded: {sorted(existing)}")

    start = _next_label_number(db, assignment_id)
    submissions = [
        Submission(
            assignment_id=assignment_id,
            student_ref=row["student_id"],
            label=f"S{start + i:03d}",
            raw_text=row["answer"],
            clean_text=redact(row["answer"], [row["student_id"], row["name"]]),
            extraction_status=ExtractionStatus.OK,
        )
        for i, row in enumerate(rows)
    ]
    db.add_all(submissions)
    db.commit()
    return [SubmissionOut.model_validate(s) for s in submissions]


@router.get("/assignments/{assignment_id}/submissions")
def list_submissions(
    assignment_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> list[SubmissionOut]:
    own_assignment(db, user, assignment_id)
    submissions = db.scalars(
        select(Submission).where(Submission.assignment_id == assignment_id).order_by(Submission.label)
    )
    return [SubmissionOut.model_validate(s) for s in submissions]


@router.delete("/submissions/{submission_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_submission(submission_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> None:
    submission = own_submission(db, user, submission_id)
    if db.scalar(select(exists().where(Grade.submission_id == submission_id, Grade.decision.is_not(None)))):
        raise HTTPException(status.HTTP_409_CONFLICT, "submission has confirmed grades")
    db.delete(submission)
    db.commit()
