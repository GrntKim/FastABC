from fastapi import APIRouter, Depends, UploadFile
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.db import get_db
from app.accounts.models import User
from app.submissions.models import Submission
from app.courses.deps import own_exam
from app.accounts.deps import page_user
from app.submissions.csv import parse, CsvError, decode
from urllib.parse import quote
from app.finalization import is_locked
from app.submissions.redact import redact

MAX_BYTES = 5 * 1024 * 1024

router = APIRouter()

@router.post("/exams/{exam_id}/submissions")
def add_submissions(
    file: UploadFile,
    exam_id: int, 
    db: Session = Depends(get_db), 
    user: User = Depends(page_user),
):
    exam = own_exam(db, user, exam_id)

    problems_dict = {p.number: p for p in exam.problems if p.number is not None}
    try:
        data = file.file.read(MAX_BYTES+1)
        if len(data) > MAX_BYTES:
            raise CsvError("CSV는 5MB까지 올릴 수 있습니다")
        rows = parse(decode(data), set(problems_dict))
    except CsvError as e:
        return RedirectResponse(f"/exams/{exam.id}?error={quote(str(e))}", status_code=303)

    added, skipped, locked = 0, 0, []

    for number, problem in sorted(problems_dict.items()):
        if is_locked(db, problem.id):
            locked.append(number)
            continue

        have = set(db.scalars(select(Submission.student_ref).where(Submission.problem_id == problem.id)))
        label_no = max((int(n[1:]) for n in db.scalars(select(Submission.label).where(Submission.problem_id == problem.id))), default=0) + 1

        for student_id, name, answers in rows:
            text = answers.get(number, "")
            if not text.strip():
                continue
            if student_id in have: 
                skipped += 1
                continue
            db.add(Submission(
                problem_id=problem.id,
                student_ref=student_id,
                student_name=name,
                label=f"S{label_no:03d}",
                raw_text=text,
                clean_text=redact(text, [student_id, name]),
                extraction_status="ok",
                source_filename=file.filename
            ))

            label_no += 1
            added += 1
            have.add(student_id)

    db.commit()
    locked = ",".join(map(str, locked))
    return RedirectResponse(f"/exams/{exam.id}?added={added}&skipped={skipped}&locked={locked}", status_code=303)