import csv, io, re
from fastapi import HTTPException, status

COLUMN_ALIASES = {"학번": "student_id", "이름": "name", "성명": "name"}
QUESTION_COLUMN = re.compile(r"^(?:문항\s*)?(\d{1,3})\s*번?$")


class CsvError(Exception): 
    pass


def decode(data: bytes) -> str:
    # Excel saves Korean CSV as cp949 unless "CSV UTF-8" is chosen
    for encoding in ("utf-8-sig", "cp949"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV must be UTF-8 or CP949 encoded")


def parse(text, numbers: set[int]) -> list[tuple[str, str | None, dict[int, str]]]:
    reader = csv.DictReader(io.StringIO(text, newline=""))
    if not reader.fieldnames:
        raise HTTPException(status.HTTP_400_BAD_REQUEST, "CSV가 비어 있습니다")
    
    id_column = name_column = None
    columns = {}
    for header in reader.fieldnames:
        key = header.strip().lower()
        role = COLUMN_ALIASES.get(key, key)
        match = QUESTION_COLUMN.match(key)
        if role == "student_id":
            id_column = header
        elif role == "name":
            name_column = header
        elif match and int(match.group(1)) in numbers:
            columns[header] = int(match.group(1))
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
        answers = {n: row.get(h) or "" for h, n in columns.items()}
        rows.append((student_id, name, answers))
    return rows