"""Load the backprop fixture into the dev DB and grade it with the real judges.

    uv run python scripts/seed_demo.py

Synthetic answers only (fine for the Gemini free tier). Costs about $0.02 per run.
Each run creates a new assignment.
"""

import csv
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).resolve().parents[2] / "data" / "backprop_v1.json"


def rubric(questions: dict) -> list[dict]:
    items = []
    for key, q in questions.items():
        item = {"key": key, **q}
        if key == "is_on_topic":
            item["kind"] = "gate"
        elif key.startswith("misc_"):
            item |= {"kind": "deduction", "points": 1}
        elif q["type"] == "score":
            item |= {"kind": "credit", "points_map": {"0": 0, "1": 1, "2": 2, "3": 4}}
        else:
            item |= {"kind": "credit", "points": 2}
        items.append(item)
    return items


def main() -> None:
    data = json.loads(FIXTURE.read_text())
    client = TestClient(app)

    r = client.post("/assignments", json={
        "title": "역전파 동작 원리 (데모)",
        "problem": data["problem"],
        "items": rubric(data["questions"]["ko"]),
    })
    r.raise_for_status()
    aid = r.json()["id"]

    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["student_id", "answer"])
    for i, answer in enumerate(data["answers"].values()):
        writer.writerow([f"2026{i + 1:04d}", answer])
    client.post(
        f"/assignments/{aid}/submissions/csv", files={"file": ("demo.csv", buf.getvalue().encode(), "text/csv")}
    ).raise_for_status()

    # TestClient runs the background escalation before returning
    client.post(f"/assignments/{aid}/grade").raise_for_status()
    status = client.get(f"/assignments/{aid}/grading").json()
    print(f"assignment {aid}: {status}")
    print(f"review: http://localhost:3000/assignments/{aid}/review")


if __name__ == "__main__":
    main()
