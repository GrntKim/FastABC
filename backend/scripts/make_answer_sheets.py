"""Turn data/demo/midterm_answers.csv into one PDF answer sheet per student, for the bulk-upload demo.

    uv run python scripts/make_answer_sheets.py

Writes data/demo/answer_sheets/<학번>_<이름>.pdf: a header line (course, exam, student), then "1번",
"2번", "3번" each followed by that student's answer, the way a typed sheet handed in through the LMS
looks. The PDFs carry text, so FastABC reads and splits them locally. Uses headless Chrome; the text is
set in Noto Sans KR with word-wise line breaks so it comes back out of the PDF with its spaces intact.
Synthetic answers only.
"""

import csv
import subprocess
import tempfile
from html import escape
from pathlib import Path

DATA = Path(__file__).resolve().parents[2] / "data/demo"
OUT = DATA / "answer_sheets"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
HEADER = "2026년 2학기 정보보호개론(01분반) 중간고사 답안"
QUESTIONS = ["1번", "2번", "3번"]

PAGE = """<!doctype html><html lang="ko"><head><meta charset="utf-8"><style>
@page {{ size: A4; margin: 22mm 20mm; }}
body {{ font-family: "Noto Sans KR", sans-serif; font-size: 11.5pt; line-height: 1.8; word-break: keep-all; color: #111; }}
header {{ border-bottom: 1px solid #111; padding-bottom: 3mm; margin-bottom: 8mm; font-size: 10pt; }}
h2 {{ font-size: 12pt; margin: 7mm 0 2mm; }}
p {{ margin: 0; white-space: pre-wrap; }}
</style></head><body>
<header>{header} · 학번 {sid} · 이름 {name}</header>
{answers}
</body></html>"""


def sheet(row: dict) -> str:
    answers = "\n".join(f"<h2>{q}</h2>\n<p>{escape(row[q].strip())}</p>" for q in QUESTIONS)
    return PAGE.format(header=HEADER, sid=row["학번"], name=escape(row["이름"]), answers=answers)


def main() -> None:
    OUT.mkdir(exist_ok=True)
    with open(DATA / "midterm_answers.csv", encoding="utf-8-sig") as f:
        rows = list(csv.DictReader(f))
    with tempfile.TemporaryDirectory() as tmp:
        for row in rows:
            html = Path(tmp) / f"{row['학번']}.html"
            html.write_text(sheet(row), encoding="utf-8")
            pdf = OUT / f"{row['학번']}_{row['이름']}.pdf"
            subprocess.run(
                [CHROME, "--headless=new", "--disable-gpu", "--no-pdf-header-footer", f"--print-to-pdf={pdf}", html.as_uri()],
                check=True,
                capture_output=True,
            )
    print(f"{len(rows)} sheets in {OUT}")


if __name__ == "__main__":
    main()
