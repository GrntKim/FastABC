import io

import pytest
from pypdf import PdfWriter

from app.grading import get_reader
from app.main import app as fastapi_app
from app.reading import clean, split_by_number
from tests.test_assignments import make_body

TEXT = "Backprop uses the chain rule to compute gradients layer by layer"


def text_pdf(text: str = TEXT) -> bytes:
    """A one-page PDF whose page carries `text` as real text (a typed answer saved as PDF)."""
    stream = f"BT /F1 12 Tf 20 100 Td ({text}) Tj ET".encode()
    objects = [
        b"<</Type/Catalog/Pages 2 0 R>>",
        b"<</Type/Pages/Kids[3 0 R]/Count 1>>",
        b"<</Type/Page/Parent 2 0 R/MediaBox[0 0 600 200]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>",
        b"<</Length %d>>stream\n" % len(stream) + stream + b"\nendstream",
        b"<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>",
    ]
    out, offsets = io.BytesIO(), []
    out.write(b"%PDF-1.4\n")
    for i, body in enumerate(objects, start=1):
        offsets.append(out.tell())
        out.write(b"%d 0 obj\n" % i + body + b"\nendobj\n")
    xref = out.tell()
    out.write(b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1))
    out.writelines(b"%010d 00000 n \n" % o for o in offsets)
    out.write(b"trailer<</Size %d/Root 1 0 R>>\nstartxref\n%d\n%%%%EOF\n" % (len(objects) + 1, xref))
    return out.getvalue()


def scanned_pdf() -> bytes:
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)  # no text layer, like a scan
    buf = io.BytesIO()
    writer.write(buf)
    return buf.getvalue()


class FakeReader:
    def __init__(self):
        self.calls: list[str] = []

    def read(self, data: bytes, mime_type: str) -> str:
        self.calls.append(mime_type)
        return "  손으로 쓴 답안입니다.\n둘째 줄  "

    def read_exam(self, data: bytes, mime_type: str, questions: dict[int, str]) -> dict[int, str]:
        self.calls.append(f"exam {mime_type} {sorted(questions)}")
        return {1: " 첫 문항 답 ", 9: "없는 문항"}  # a number the exam does not have is dropped


@pytest.fixture
def reader():
    fake = FakeReader()
    fastapi_app.dependency_overrides[get_reader] = lambda: fake
    yield fake
    fastapi_app.dependency_overrides.pop(get_reader, None)


@pytest.fixture
def aid(client, course_id) -> int:
    return client.post("/assignments", json=make_body(course_id)).json()["id"]


def read(client, aid: int, data: bytes, mime: str):
    return client.post(f"/assignments/{aid}/readings", files={"file": ("answer", data, mime)})


def test_text_pdf_is_read_locally(client, aid, reader):
    r = read(client, aid, text_pdf(), "application/pdf")
    assert r.status_code == 200, r.text
    assert r.json() == {"text": TEXT, "method": "text"}
    assert reader.calls == []  # nothing left the machine


def test_scans_and_photos_go_to_the_reader(client, aid, reader):
    assert read(client, aid, scanned_pdf(), "application/pdf").json() == {"text": "손으로 쓴 답안입니다.\n둘째 줄", "method": "ai"}
    assert read(client, aid, b"\x89PNG fake", "image/png").json()["method"] == "ai"
    assert reader.calls == ["application/pdf", "image/png"]


def test_unreadable_files(client, aid, reader):
    assert read(client, aid, b"not a pdf", "application/pdf").status_code == 400
    assert read(client, aid, b"x", "text/plain").status_code == 400
    assert reader.calls == []


def test_add_one_checked_answer(client, aid):
    body = {"student_id": "20241101", "name": "김민준", "answer": "김민준입니다. 연쇄법칙을 쓴다.", "source_filename": "a.pdf"}
    r = client.post(f"/assignments/{aid}/submissions", json=body)
    assert r.status_code == 201
    s = r.json()
    assert (s["label"], s["student_name"], s["source_filename"]) == ("S001", "김민준", "a.pdf")
    assert s["clean_text"] == "[식별 정보]입니다. 연쇄법칙을 쓴다."  # redacted like CSV answers
    assert client.post(f"/assignments/{aid}/submissions", json=body).status_code == 409
    assert client.get(f"/assignments/{aid}/grading").json()["total"] == 0  # saved, not graded


def test_reading_needs_your_question(stranger, client, aid, reader):
    assert stranger.post(f"/assignments/{aid}/readings", files={"file": ("a", b"x", "image/png")}).status_code == 404
    assert stranger.post(f"/assignments/{aid}/submissions", json={"student_id": "1", "answer": "a"}).status_code == 404


def test_split_by_question_number():
    sheet = "학번 2024 이름 홍길동\n1번. 해시와 솔트\n1. 입력 검증\n2. 최소 권한\n2번\n위 1번 답처럼 쓴다\n[3번] 대칭키"
    answers, rest = split_by_number(sheet, [1, 2, 3])
    # "1." lists and a "1번" inside a line are part of the answer, not new questions
    assert answers == {1: "해시와 솔트\n1. 입력 검증\n2. 최소 권한", 2: "위 1번 답처럼 쓴다", 3: "대칭키"}
    assert rest == "학번 2024 이름 홍길동"
    assert split_by_number("3번 c\n1번 a", [1, 3]) == ({3: "c\n1번 a"}, "")  # numbers only rise
    assert split_by_number("문항 2: 답", [2]) == ({2: "답"}, "")
    assert split_by_number("번호 없는 답안", [1, 2]) == ({}, "번호 없는 답안")


def test_split_stops_at_a_question_the_exam_lacks():
    # the sheet answers 3번 before the exam has it: 2번 ends there and 3번 stays out with the header
    sheet = "머리말\n1번\n가\n2번\n나\n3번\n다"
    assert split_by_number(sheet, [1, 2]) == ({1: "가", 2: "나"}, "머리말\n\n3번\n다")
    assert split_by_number("1번\n가\n3번째로 나\n2번\n다", [1, 2]) == ({1: "가\n3번째로 나", 2: "다"}, "")


def test_pdf_spaces_are_spaces():
    assert clean("사용자\x01입력을\tSQL  문에\n 다음 줄 ") == "사용자 입력을 SQL 문에\n다음 줄"


@pytest.fixture
def exam(client, course_id) -> dict:
    exam_id = client.post(f"/courses/{course_id}/exams", json={"name": "중간고사"}).json()["id"]
    ids = [client.post("/assignments", json=make_body(course_id) | {"exam_id": exam_id, "number": n}).json()["id"] for n in (1, 2)]
    return {"id": exam_id, "questions": ids}


def read_sheet(client, exam_id: int, data: bytes, mime: str):
    return client.post(f"/exams/{exam_id}/readings", files={"file": ("sheet", data, mime)})


def test_whole_sheet_pdf_is_split_locally(client, exam, reader, monkeypatch):
    monkeypatch.setattr("app.reading.pdf_text", lambda data: "학번 20240001\n1번 첫 답\n2번 둘째 답")
    r = read_sheet(client, exam["id"], text_pdf(), "application/pdf")
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["method"], body["rest"], reader.calls) == ("text", "학번 20240001", [])
    assert [(a["assignment_id"], a["number"], a["text"], a["locked"]) for a in body["answers"]] == [
        (exam["questions"][0], 1, "첫 답", False),
        (exam["questions"][1], 2, "둘째 답", False),
    ]


def test_whole_sheet_photo_goes_to_the_reader(client, exam, reader):
    r = read_sheet(client, exam["id"], b"\x89PNG fake", "image/png")
    assert reader.calls == ["exam image/png [1, 2]"]
    assert [(a["number"], a["text"]) for a in r.json()["answers"]] == [(1, "첫 문항 답"), (2, "")]
    assert r.json()["method"] == "ai"


def test_sheet_needs_numbered_questions(client, course_id, reader, stranger, exam):
    empty = client.post(f"/courses/{course_id}/exams", json={"name": "기말고사"}).json()["id"]
    assert read_sheet(client, empty, text_pdf(), "application/pdf").status_code == 400
    assert read_sheet(stranger, exam["id"], text_pdf(), "application/pdf").status_code == 404
