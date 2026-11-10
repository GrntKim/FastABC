import io

import pytest
from pypdf import PdfWriter

from app.grading import get_reader
from app.main import app as fastapi_app
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
