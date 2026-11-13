from fastapi.templating import Jinja2Templates
from pathlib import Path
from app.review.logic import point_options

_SESSION_LABEL = {"1": "1학기", "1S": "여름 계절학기", "2": "2학기", "2W": "겨울 계절학기"}

APP_DIR = Path(__file__).resolve().parents[1]

templates = Jinja2Templates(directory=APP_DIR / "templates")


def term_label(term: str) -> str:
    year, _, session = term.partition("-")
    return f"{year}년 {_SESSION_LABEL.get(session, session)}"

def plain(text: str) -> str:
    """판단 질문 표기를 채점자 말로: `answer` → 답안, `question` → 문제"""
    return text.replace("`answer`", "답안").replace("`question`", "문제").replace("`", "")

templates.env.filters["plain"] = plain
templates.env.filters["term_label"] = term_label
templates.env.globals["point_options"] = point_options