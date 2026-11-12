from fastapi.templating import Jinja2Templates
from pathlib import Path

_SESSION_LABEL = {"1": "1학기", "1S": "여름 계절학기", "2": "2학기", "2W": "겨울 계절학기"}

APP_DIR = Path(__file__).resolve().parents[1]

templates = Jinja2Templates(directory=APP_DIR / "templates")


def term_label(term: str) -> str:
    year, _, session = term.partition("-")
    return f"{year}년 {_SESSION_LABEL.get(session, session)}"


templates.env.filters["term_label"] = term_label