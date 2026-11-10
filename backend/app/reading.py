"""Answers that arrive as documents or pictures: a PDF, a scan, a photo, a webcam shot.

A PDF that carries its text is read here, so nothing leaves the machine. Anything else is an
image of handwriting, and an LLM transcribes it. Either way the grader checks the text against
the original before it is saved; redaction then runs as for CSV answers.
"""

import io
from typing import Protocol

from pypdf import PdfReader
from pypdf.errors import PdfReadError

PDF = "application/pdf"
IMAGES = {"image/png", "image/jpeg", "image/webp"}
MAX_BYTES = 10 * 1024 * 1024
MAX_PAGES = 10
# fewer visible characters than this and the PDF is taken for a scan with no text layer
MIN_TEXT = 20


class AnswerReader(Protocol):
    """Transcribes an image or a scanned PDF of a handwritten or printed answer, word for word."""

    def read(self, data: bytes, mime_type: str) -> str: ...


class UnreadableFile(ValueError):
    """Not a file we can read: a broken PDF, too many pages, or an unsupported type."""


def pdf_text(data: bytes) -> str | None:
    """The PDF's own text, page after page; None for a scan (no text layer to speak of)."""
    try:
        reader = PdfReader(io.BytesIO(data))
        if len(reader.pages) > MAX_PAGES:
            raise UnreadableFile(f"PDF는 {MAX_PAGES}쪽까지 읽습니다")
        pages = [(page.extract_text() or "").strip() for page in reader.pages]
    except PdfReadError as e:
        raise UnreadableFile("PDF를 열지 못했습니다") from e
    text = "\n\n".join(p for p in pages if p)
    return text if len("".join(text.split())) >= MIN_TEXT else None


def read_answer(data: bytes, mime_type: str, reader: AnswerReader) -> tuple[str, str]:
    """(text, method): "text" when taken from the PDF itself, "ai" when an LLM transcribed it."""
    if mime_type == PDF:
        text = pdf_text(data)
        if text is not None:
            return text, "text"
    elif mime_type not in IMAGES:
        raise UnreadableFile("PDF나 PNG·JPEG·WEBP 이미지만 읽습니다")
    return reader.read(data, mime_type).strip(), "ai"
