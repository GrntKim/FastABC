"""Exams: a course's questions grouped as one test, with results added up per student.

Grading stays per question. An exam also takes points graded elsewhere (multiple choice from the
LMS or an OMR sheet) as imported columns: FastABC does not score multiple choice itself.
"""

import csv
import io

from fastapi import (
    APIRouter,
    Depends,
    File,
    Form,
    HTTPException,
    Response,
    UploadFile,
    status,
)
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import current_user, own_course, own_exam
from app.db import get_db
from app.models import Exam, ImportedPart, ImportedScore, User
from app.progress import Stage, progress
from app.routers.review import submission_results
from app.routers.submissions import MAX_UPLOAD_BYTES, _decode
from app.schemas import (
    CourseRef,
    ExamCell,
    ExamColumn,
    ExamIn,
    ExamRef,
    ExamResults,
    ExamStudent,
)
from app.scoring import max_total

router = APIRouter(tags=["exams"])

# Korean headers as LMS and OMR exports usually have them
IMPORT_ALIASES = {"학번": "student_id", "이름": "name", "성명": "name", "점수": "points", "score": "points"}


def _conflict() -> HTTPException:
    return HTTPException(status.HTTP_409_CONFLICT, "이 과목에 같은 이름의 시험이 있습니다")


@router.post("/courses/{course_id}/exams", status_code=status.HTTP_201_CREATED)
def create_exam(course_id: int, body: ExamIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> ExamRef:
    own_course(db, user, course_id)
    exam = Exam(course_id=course_id, name=body.name)
    db.add(exam)
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return ExamRef.model_validate(exam)


@router.patch("/exams/{exam_id}")
def rename_exam(exam_id: int, body: ExamIn, db: Session = Depends(get_db), user: User = Depends(current_user)) -> ExamRef:
    exam = own_exam(db, user, exam_id)
    exam.name = body.name
    try:
        db.commit()
    except IntegrityError:
        db.rollback()
        raise _conflict() from None
    return ExamRef.model_validate(exam)


@router.delete("/exams/{exam_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_exam(exam_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> None:
    """Its questions stay in the course without an exam; imported points go with it."""
    exam = own_exam(db, user, exam_id)
    for a in exam.assignments:
        a.exam, a.number = None, None  # a number means nothing outside its exam
    db.delete(exam)
    db.commit()


def _results(db: Session, exam: Exam) -> ExamResults:
    questions = sorted(exam.assignments, key=lambda a: (a.number is None, a.number or 0, a.created_at))
    stats = progress(db, [a.id for a in questions])
    columns = [
        ExamColumn(
            kind="question",
            id=a.id,
            title=a.title,
            number=a.number,
            max_points=max_total(a.items),
            stage=stats[a.id].stage,
        )
        for a in questions
    ] + [
        ExamColumn(kind="imported", id=p.id, title=p.title, number=None, max_points=p.max_points, stage=None)
        for p in exam.imports
    ]

    # student_ref -> name, and column index -> points (None: undecided)
    names: dict[str, str | None] = {}
    points: dict[str, dict[int, float | None]] = {}
    for col, a in enumerate(questions):
        by_id = {s.id: s for s in a.submissions}
        for r in submission_results(db, a):
            s = by_id[r.submission_id]
            names[s.student_ref] = names.get(s.student_ref) or s.student_name
            points.setdefault(s.student_ref, {})[col] = r.total
    for offset, part in enumerate(exam.imports):
        for score in part.scores:
            names[score.student_ref] = names.get(score.student_ref) or score.student_name
            points.setdefault(score.student_ref, {})[len(questions) + offset] = score.points

    students = []
    for ref in sorted(points, key=lambda r: (len(r), r)):
        got = points[ref]
        cells = [ExamCell(points=got.get(i), submitted=i in got) for i in range(len(columns))]
        undecided = any(c.submitted and c.points is None for c in cells)
        total = None if undecided else sum(c.points or 0 for c in cells)
        students.append(ExamStudent(student_ref=ref, student_name=names.get(ref), cells=cells, total=total))

    return ExamResults(
        exam=ExamRef.model_validate(exam),
        course=CourseRef.model_validate(exam.course),
        columns=columns,
        students=students,
        max_points=sum(c.max_points for c in columns),
        finalized=bool(questions) and all(stats[a.id].stage == Stage.FINALIZED for a in questions),
    )


@router.get("/exams/{exam_id}/results")
def exam_results(exam_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> ExamResults:
    return _results(db, own_exam(db, user, exam_id))


@router.get("/exams/{exam_id}/export.csv")
def export_exam(exam_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> Response:
    """One row per student: points per column and the total. Undecided cells are empty, missing answers "-"."""
    results = _results(db, own_exam(db, user, exam_id))
    buf = io.StringIO()
    writer = csv.writer(buf)
    titles = [f"{c.number}번 {c.title}" if c.number is not None else c.title for c in results.columns]
    writer.writerow(["student_id", "name", *titles, "total"])
    for s in results.students:
        cells = ["-" if not c.submitted else "" if c.points is None else c.points for c in s.cells]
        writer.writerow([s.student_ref, s.student_name or "", *cells, "" if s.total is None else s.total])
    return Response(
        "﻿" + buf.getvalue(),  # BOM so Excel reads UTF-8 Korean
        media_type="text/csv; charset=utf-8",
        headers={"Content-Disposition": f'attachment; filename="exam_{exam_id}.csv"'},
    )


def _parse_scores(text: str, max_points: float) -> list[dict]:
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if reader.fieldnames is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV is empty")
    reader.fieldnames = [IMPORT_ALIASES.get(n.strip().lower(), n.strip().lower()) for n in reader.fieldnames]
    missing = {"student_id", "points"} - set(reader.fieldnames)
    if missing:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, f"missing columns: {sorted(missing)}")
    rows, seen = [], set()
    for line, row in enumerate(reader, start=2):
        ref = (row.get("student_id") or "").strip()
        if not ref:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"line {line}: student_id is empty")
        if ref in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"line {line}: duplicate student_id {ref}")
        seen.add(ref)
        try:
            value = float((row.get("points") or "").strip())
        except ValueError:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"line {line}: points is not a number") from None
        if not 0 <= value <= max_points:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"line {line}: points must be between 0 and {max_points:g}")
        rows.append({"student_ref": ref, "student_name": (row.get("name") or "").strip() or None, "points": value})
    if not rows:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV has no rows")
    return rows


@router.post("/exams/{exam_id}/imports", status_code=status.HTTP_201_CREATED)
def import_scores(
    exam_id: int,
    file: UploadFile = File(),
    title: str = Form(min_length=1, max_length=100),
    max_points: float = Form(gt=0),
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
) -> ExamColumn:
    """Columns: student_id (학번), points (점수), optional name (이름)."""
    exam = own_exam(db, user, exam_id)
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "CSV is larger than 5 MB")
    rows = _parse_scores(_decode(data), max_points)
    part = ImportedPart(
        exam_id=exam.id,
        title=title.strip(),
        max_points=max_points,
        source_filename=file.filename,
        scores=[ImportedScore(**r) for r in rows],
    )
    db.add(part)
    db.commit()
    return ExamColumn(kind="imported", id=part.id, title=part.title, number=None, max_points=part.max_points, stage=None)


@router.delete("/imports/{part_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_import(part_id: int, db: Session = Depends(get_db), user: User = Depends(current_user)) -> None:
    part = db.get(ImportedPart, part_id)
    if part is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "import not found")
    own_exam(db, user, part.exam_id)  # 404 for someone else's
    db.delete(part)
    db.commit()

