"""Answers that arrive as documents or pictures: a PDF, a scan, a photo, a webcam shot.

A PDF that carries its text is read here, so nothing leaves the machine. Anything else is an
image of handwriting, and an LLM transcribes it. Either way the grader checks the text against
the original before it is saved; redaction then runs as for CSV answers.
"""

import io
import re
from collections.abc import Iterable
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

    def read_exam(self, data: bytes, mime_type: str, questions: dict[int, str]) -> dict[int, str]:
        """A whole exam's answer sheet -> each question's answer by number (questions: number -> problem)."""
        ...


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
    text = clean("\n\n".join(p for p in pages if p))
    return text if len("".join(text.split())) >= MIN_TEXT else None


def clean(text: str) -> str:
    """Spaces as spaces: some fonts come out of a PDF with tabs or control characters between words."""
    text = re.sub(r"[\x00-\x08\x0b-\x1f\x7f]", " ", text)
    return "\n".join(re.sub(r"[ \t]+", " ", line).strip() for line in text.split("\n"))


# A question number opening a line: "1번", "[2번]", "3 번.", "문항 4". A bare "1." or "1)" is not one:
# students number their own points that way inside an answer.
# "3번째로" opening a line is prose, not a question mark
MARK = re.compile(r"^[ \t]*\[?[ \t]*(?:문항[ \t]*(\d{1,3})|(\d{1,3})[ \t]*번(?!째))[ \t]*[\].:)]?", re.M)


def split_by_number(text: str, numbers: Iterable[int]) -> tuple[dict[int, str], str]:
    """A whole sheet's text -> (answer per question number, text that belongs to no question asked).
    Numbers count only in rising order, so a "2번" quoted inside answer 3 starts nothing. Every rising
    number ends the answer above it, even one the exam lacks (3번 on the sheet before 3번 is made), so
    that answer never runs into 2번; it goes to the rest with the header, and the rest is not saved."""
    wanted, marks, last = set(numbers), [], 0
    for m in MARK.finditer(text):
        n = int(m.group(1) or m.group(2))
        if n > last:
            marks.append((n, m.start(), m.end()))
            last = n
    answers, rest = {}, [text[: marks[0][1]] if marks else text]
    for i, (n, start, end) in enumerate(marks):
        stop = marks[i + 1][1] if i + 1 < len(marks) else len(text)
        if n in wanted:
            answers[n] = text[end:stop].strip()
        else:
            rest.append(text[start:stop])
    return answers, "\n\n".join(r.strip() for r in rest if r.strip())


def read_exam(
    data: bytes, mime_type: str, reader: AnswerReader, questions: dict[int, str]
) -> tuple[dict[int, str], str, str]:
    """(answers by question number, text that belongs to no question, method). A PDF with text is split
    here by the numbers on the sheet; a scan or photo goes to the LLM with the questions to split by."""
    if mime_type == PDF:
        text = pdf_text(data)
        if text is not None:
            answers, rest = split_by_number(text, questions)
            if not answers and len(questions) == 1:
                # a one-question exam (a homework, a quiz) needs no number on the sheet: all of it is the answer
                answers, rest = {next(iter(questions)): text}, ""
            return answers, rest, "text"
    elif mime_type not in IMAGES:
        raise UnreadableFile("PDF나 PNG·JPEG·WEBP 이미지만 읽습니다")
    answers = {n: t.strip() for n, t in reader.read_exam(data, mime_type, questions).items() if n in questions}
    return answers, "", "ai"


def read_answer(data: bytes, mime_type: str, reader: AnswerReader) -> tuple[str, str]:
    """(text, method): "text" when taken from the PDF itself, "ai" when an LLM transcribed it."""
    if mime_type == PDF:
        text = pdf_text(data)
        if text is not None:
            return text, "text"
    elif mime_type not in IMAGES:
        raise UnreadableFile("PDF나 PNG·JPEG·WEBP 이미지만 읽습니다")
    return reader.read(data, mime_type).strip(), "ai"
