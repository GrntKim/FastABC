"""Remove identifying information from answers before they are sent to external APIs.

Best effort: known values (student id, name) are removed exactly; labeled fields and
id/email/phone patterns by regex. A name written without a label and not given in the
upload cannot be detected.
"""

import re

LABELED = re.compile(r"(학번|이름|성명|학과|student\s*id)\s*[:：][^\n]*", re.IGNORECASE)
STUDENT_ID = re.compile(r"(?<!\d)(19|20)\d{6,8}(?!\d)")  # 8-10 digits starting with a year
EMAIL = re.compile(r"[\w.+-]+@[\w-]+(\.[\w-]+)+")
PHONE = re.compile(r"(?<!\d)01[016789][-. ]?\d{3,4}[-. ]?\d{4}(?!\d)")


def redact(text: str, known: list[str | None] = ()) -> str:
    for value in sorted({v.strip() for v in known if v and v.strip()}, key=len, reverse=True):
        text = text.replace(value, "[식별 정보]")
    text = LABELED.sub("[식별 정보]", text)
    text = EMAIL.sub("[이메일]", text)
    text = PHONE.sub("[전화번호]", text)
    return STUDENT_ID.sub("[학번]", text)
