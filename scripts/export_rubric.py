"""Freeze an assignment made in the app into an evaluation question folder.

    uv run python scripts/export_rubric.py --assignment 6 --id q1_sql_injection [--set ../data/eval] [--rubric-text "..."]

Writes <set>/<id>/question.json (problem + final rubric items) and, if missing, an answers.csv template
with one label column per item key. Fill answers and labels in a spreadsheet. Never overwrites answers.csv,
and keeps an edited question.json unless --force.
"""

import argparse
import csv
import json
from pathlib import Path

from app.core.db import SessionLocal
from app.models import Problem

# eval question.json keeps the judge format's name "criteria" for what the app calls descriptions
ITEM_FIELDS = {"key": "key", "label": "label", "type": "type", "kind": "kind", "instructions": "instructions",
               "criteria": "descriptions", "points": "points", "points_map": "points_map"}


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--assignment", type=int, required=True)
    parser.add_argument("--id", required=True, help="question folder name, e.g. q1_sql_injection")
    parser.add_argument("--set", default=str(Path(__file__).resolve().parents[2] / "data" / "eval"))
    parser.add_argument("--rubric-text", default="", help="the plain-language rubric it was drafted from")
    parser.add_argument("--force", action="store_true", help="overwrite an existing question.json (loses hand edits)")
    args = parser.parse_args()

    with SessionLocal() as db:
        a = db.get(Problem, args.assignment)
        if a is None:
            raise SystemExit(f"assignment {args.assignment} not found")
        items = [{k: getattr(i, attr) for k, attr in ITEM_FIELDS.items()} for i in a.criteria]
        question = {
            "id": args.id,
            "title": a.title,
            "problem": a.text,
            "rubric_text": args.rubric_text,
            "items": items,
        }

    folder = Path(args.set) / args.id
    folder.mkdir(parents=True, exist_ok=True)
    if (folder / "question.json").exists() and not args.force:
        raise SystemExit(f"{folder / 'question.json'} exists (may hold hand edits); pass --force to overwrite")
    (folder / "question.json").write_text(json.dumps(question, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {folder / 'question.json'} ({len(items)} items)")

    answers = folder / "answers.csv"
    if answers.exists():
        print(f"kept existing {answers}")
        return
    with answers.open("w", newline="", encoding="utf-8-sig") as f:  # BOM: Excel opens Korean correctly
        csv.writer(f).writerow(["answer_id", "type", "answer", *(i["key"] for i in items), "note"])
    print(f"wrote template {answers}")


if __name__ == "__main__":
    main()
