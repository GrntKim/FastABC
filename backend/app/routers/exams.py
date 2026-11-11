"""Exams: a course's questions grouped as one test, with results added up per student.

Grading stays per question. An exam also takes points graded elsewhere (multiple choice from the
LMS or an OMR sheet) as imported columns: FastABC does not score multiple choice itself.
"""

import csv
import io
import re

import httpx
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
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.auth import current_user, own_course, own_exam
from app.db import get_db
from app.finalization import is_locked
from app.grading import get_reader
from app.models import Exam, ExtractionStatus, ImportedPart, ImportedScore, Submission, User
from app.progress import Stage, progress
from app.reading import MAX_BYTES as MAX_READ_BYTES
from app.reading import AnswerReader, UnreadableFile, read_exam
from app.routers.review import submission_results
from app.redact import redact
from app.routers.submissions import COLUMN_ALIASES, MAX_UPLOAD_BYTES, _decode, _next_label_number
from app.schemas import (
    CourseRef,
    ExamAnswerOut,
    ExamCell,
    ExamColumn,
    ExamCsvOut,
    ExamCsvQuestion,
    ExamIn,
    ExamReadingOut,
    ExamRef,
    ExamResults,
    ExamStudent,
)
from app.scoring import max_total

router = APIRouter(tags=["exams"])

# Korean headers as LMS and OMR exports usually have them
IMPORT_ALIASES = {"학번": "student_id", "이름": "name", "성명": "name", "점수": "points", "score": "points"}
# a question's column in a whole-exam CSV: "1번", "문항 1", "1"
QUESTION_COLUMN = re.compile(r"^(?:문항\s*)?(\d{1,3})\s*번?$")


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
    answers: dict[tuple[str, int], int] = {}  # (student_ref, column) -> submission id
    for col, a in enumerate(questions):
        by_id = {s.id: s for s in a.submissions}
        for r in submission_results(db, a):
            s = by_id[r.submission_id]
            names[s.student_ref] = names.get(s.student_ref) or s.student_name
            points.setdefault(s.student_ref, {})[col] = r.total
            answers[s.student_ref, col] = s.id
    for offset, part in enumerate(exam.imports):
        for score in part.scores:
            names[score.student_ref] = names.get(score.student_ref) or score.student_name
            points.setdefault(score.student_ref, {})[len(questions) + offset] = score.points

    students = []
    for ref in sorted(points, key=lambda r: (len(r), r)):
        got = points[ref]
        cells = [
            ExamCell(points=got.get(i), submitted=i in got, submission_id=answers.get((ref, i))) for i in range(len(columns))
        ]
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


@router.post("/exams/{exam_id}/readings")
def read_answer_sheet(
    exam_id: int,
    file: UploadFile,
    db: Session = Depends(get_db),
    user: User = Depends(current_user),
    reader: AnswerReader = Depends(get_reader),
) -> ExamReadingOut:
    """One student's sheet for the whole exam -> the answer to each numbered question, for the grader to
    check. Nothing is saved: each answer then goes to its question like any single answer."""
    exam = own_exam(db, user, exam_id)
    questions = sorted((a for a in exam.assignments if a.number is not None), key=lambda a: a.number)
    if not questions:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "번호가 붙은 문항이 없습니다")
    data = file.file.read(MAX_READ_BYTES + 1)
    if len(data) > MAX_READ_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "파일은 10 MB까지 읽습니다")
    try:
        answers, rest, method = read_exam(data, file.content_type or "", reader, {a.number: a.problem for a in questions})
    except UnreadableFile as e:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, str(e)) from e
    except httpx.HTTPError as e:
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, f"reader failed: {e}") from e
    return ExamReadingOut(
        method=method,
        rest=rest,
        answers=[
            ExamAnswerOut(
                assignment_id=a.id, number=a.number, title=a.title, text=answers.get(a.number, ""), locked=is_locked(db, a.id)
            )
            for a in questions
        ],
    )


@router.post("/exams/{exam_id}/submissions/csv", status_code=status.HTTP_201_CREATED)
def upload_exam_csv(
    exam_id: int, file: UploadFile, db: Session = Depends(get_db), user: User = Depends(current_user)
) -> ExamCsvOut:
    """One row per student: 학번, optional 이름, and a column per question ("1번", "2번", … or "문항 1").
    Each answer goes to its question as if uploaded there. A blank cell is no answer; a student who already
    has an answer for the question, or a signed-off question, is skipped rather than refused."""
    exam = own_exam(db, user, exam_id)
    numbered = {a.number: a for a in exam.assignments if a.number is not None}
    data = file.file.read(MAX_UPLOAD_BYTES + 1)
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_CONTENT_TOO_LARGE, "CSV는 5 MB까지 올립니다")
    reader = csv.DictReader(io.StringIO(_decode(data), newline=""))
    if not reader.fieldnames:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV가 비어 있습니다")

    id_column = name_column = None
    columns, ignored = {}, []  # header -> question
    for header in reader.fieldnames:
        key = header.strip().lower()
        role = COLUMN_ALIASES.get(key, key)
        match = QUESTION_COLUMN.match(key)
        if role == "student_id":
            id_column = header
        elif role == "name":
            name_column = header
        elif match and int(match.group(1)) in numbered:
            columns[header] = numbered[int(match.group(1))]
        else:
            ignored.append(header)
    if id_column is None:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "학번 열이 없습니다")
    if not columns:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "이 시험의 문항 열(1번, 2번…)이 없습니다")

    rows, seen = [], set()
    for line, row in enumerate(reader, start=2):
        student_id = (row.get(id_column) or "").strip()
        if not student_id:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{line}번째 줄: 학번이 비어 있습니다")
        if student_id in seen:
            raise HTTPException(status.HTTP_400_BAD_REQUEST, f"{line}번째 줄: 학번 {student_id}이 두 번 나옵니다")
        seen.add(student_id)
        name = (row.get(name_column) or "").strip() or None if name_column else None
        rows.append((student_id, name, row))

    added, skipped, locked = [], 0, []
    for header, a in sorted(columns.items(), key=lambda c: c[1].number):
        if is_locked(db, a.id):
            locked.append(a.number)
            continue
        have = set(db.scalars(select(Submission.student_ref).where(Submission.assignment_id == a.id)))
        label, created = _next_label_number(db, a.id), 0
        for student_id, name, row in rows:
            text = row.get(header) or ""
            if not text.strip():
                continue
            if student_id in have:
                skipped += 1
                continue
            db.add(Submission(
                assignment_id=a.id,
                student_ref=student_id,
                student_name=name,
                label=f"S{label + created:03d}",
                raw_text=text,
                clean_text=redact(text, [student_id, name]),
                extraction_status=ExtractionStatus.OK,
            ))
            created += 1
        added.append(ExamCsvQuestion(assignment_id=a.id, number=a.number, created=created))
    db.commit()
    return ExamCsvOut(questions=added, skipped_existing=skipped, locked=locked, ignored_columns=ignored)


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

