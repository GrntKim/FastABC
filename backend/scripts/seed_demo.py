"""Load the backprop fixture into the dev DB and grade it with the real judges.

    uv run python scripts/seed_demo.py

Synthetic answers only (fine for a free-tier LLM key). Costs about $0.02 per run.
Each run creates a new assignment.
"""

import csv
import io
import json
from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app

FIXTURE = Path(__file__).resolve().parents[2] / "data" / "backprop_v1.json"
COURSE = {"department": "컴퓨터공학과", "term": "2026-2", "name": "딥러닝개론", "section": "01"}


LABELS = {
    "is_on_topic": "주제 관련성",
    "mentions_chain_rule": "연쇄법칙 언급",
    "mentions_weight_update": "가중치 갱신 언급",
    "accuracy": "설명 정확도",
    "misc_is_optimizer": "오개념: 역전파를 최적화 알고리즘으로 봄",
    "misc_error_copied": "오개념: 오차를 그대로 모든 층에 전달",
    "misc_reverse_inference": "오개념: 신경망을 거꾸로 실행",
}


def rubric(questions: dict) -> list[dict]:
    items = []
    for key, q in questions.items():
        item = {"key": key, "label": LABELS.get(key), **q}
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

    r = client.post("/courses", json=COURSE)
    if r.status_code == 409:  # reuse the demo course on later runs
        course_id = next(c["id"] for c in client.get("/courses").json() if all(c[k] == v for k, v in COURSE.items()))
    else:
        r.raise_for_status()
        course_id = r.json()["id"]

    r = client.post("/assignments", json={
        "course_id": course_id,
        "assessment": "중간고사 1번",
        "title": "역전파 동작 원리",
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
