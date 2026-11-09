"""Evaluation: hybrid (decision model + LLM escalation) vs LLM only, against the grader's own labels.

    uv run python scripts/run_eval.py run [--set ../data/eval] [--questions q1,q2] [--workers 2] [--resume RUN_ID]
    uv run python scripts/run_eval.py analyze --run ../data/eval/runs/RUN_ID

`run` calls the APIs once per answer and appends every raw response to runs/<id>/raw/<question>.jsonl.
`analyze` reads only those files, so the analysis can be repeated without API calls or cost.
Per answer it records four calls: primary judge, escalation of unsure questions, LLM judging every
question (the LLM-only baseline), and the on-demand evidence lookup the app makes for confident cells.
"""

import argparse
import csv
import json
import statistics
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import asdict
from datetime import datetime
from pathlib import Path

from app.grading import PRIMARY_MODEL, make_judges
from app.judges.base import GATE, Judgment
from app.judges.routing import needs_escalation

DEFAULT_SET = Path(__file__).resolve().parents[2] / "data" / "eval"

# USD per 1M tokens, recorded 2026-11 (see CLAUDE_LEGACY.md B, C). Thinking tokens are billed as output.
PRICE = {"primary_input": 0.042, "secondary_input": 0.75, "secondary_output": 3.75}

TRUE_LABELS = {"1", "o", "y", "yes", "true", "예", "참"}
FALSE_LABELS = {"0", "x", "n", "no", "false", "아니오", "거짓"}


# ---------- data ----------

def load_questions(set_dir: Path, only: list[str] | None) -> list[dict]:
    questions = []
    for qfile in sorted(set_dir.glob("*/question.json")):
        q = json.loads(qfile.read_text())
        if only and q["id"] not in only:
            continue
        data = (qfile.parent / "answers.csv").read_bytes()
        try:
            text = data.decode("utf-8-sig")
        except UnicodeDecodeError:
            text = data.decode("cp949")
        q["answers"] = [r for r in csv.DictReader(text.splitlines()) if (r.get("answer_id") or "").strip()]
        questions.append(q)
    return questions


def judge_questions(items: list[dict]) -> dict[str, dict]:
    out = {}
    for i in items:
        q = {"type": i["type"], "instructions": i["instructions"]}
        if i.get("criteria") is not None:
            q["criteria"] = i["criteria"]
        out[i["key"]] = q
    return out


def parse_label(raw: str | None, item: dict):
    value = (raw or "").strip()
    if not value:
        return None
    if item["type"] == "noul":
        low = value.lower()
        if low in TRUE_LABELS:
            return True
        if low in FALSE_LABELS:
            return False
        raise ValueError(f"{item['key']}: '{value}' is not a yes/no label")
    if item["type"] == "score":
        return int(float(value))
    return value


# ---------- run ----------

def _call(judge, problem: str, answer: str, questions: dict) -> dict:
    if not questions:
        return {"skipped_call": True, "judgments": [], "latency": 0.0, "usage": {}}
    t0 = time.perf_counter()
    try:
        judgments = judge.evaluate(problem, answer, questions)
    except Exception as e:  # keep going; the analysis treats a failed call as no prediction
        return {"error": repr(e), "judgments": [], "latency": time.perf_counter() - t0, "usage": {}}
    return {
        "judgments": [asdict(j) for j in judgments],
        "latency": getattr(judge, "last_latency", None) or time.perf_counter() - t0,
        "usage": dict(getattr(judge, "last_usage", {}) or {}),
    }


def run_answer(question: dict, row: dict) -> dict:
    judges = make_judges()  # per call: judges keep last usage/latency on the instance
    problem, answer, questions = question["problem"], row["answer"], judge_questions(question["items"])

    primary = _call(judges.primary, problem, answer, questions)
    first = [Judgment(**j) for j in primary["judgments"]]
    escalated = [j.question_id for j in first if needs_escalation(j)]
    confident = [j.question_id for j in first if not needs_escalation(j) and not j.skipped and j.question_id != GATE]
    return {
        "answer_id": row["answer_id"],
        "primary": primary,
        "escalation": _call(judges.secondary, problem, answer, {k: questions[k] for k in escalated}),
        "llm_only": _call(judges.secondary, problem, answer, questions),
        "evidence": _call(judges.evidence_judge, problem, answer, {k: questions[k] for k in confident}),
    }


def run(args) -> None:
    set_dir = Path(args.set)
    questions = load_questions(set_dir, args.questions.split(",") if args.questions else None)
    if not questions:
        raise SystemExit(f"no question.json under {set_dir}")
    run_id = args.resume or datetime.now().strftime("%Y%m%d-%H%M%S")
    out = set_dir / "runs" / run_id
    (out / "raw").mkdir(parents=True, exist_ok=True)

    judges = make_judges()
    commit = subprocess.run(["git", "rev-parse", "--short", "HEAD"], capture_output=True, text=True).stdout.strip()
    meta = {
        "run_id": run_id,
        "started": datetime.now().isoformat(timespec="seconds"),
        "git_commit": commit,
        "primary_model": PRIMARY_MODEL,
        "secondary_model": getattr(judges.secondary, "model", "?"),
        "evidence_thinking_level": getattr(judges.evidence_judge, "thinking_level", None),
        "questions": [q["id"] for q in questions],
        "price_per_1m_tokens": PRICE,
    }
    if not (out / "meta.json").exists():
        (out / "meta.json").write_text(json.dumps(meta, ensure_ascii=False, indent=2) + "\n")

    lock = threading.Lock()
    for q in questions:
        raw = out / "raw" / f"{q['id']}.jsonl"
        done = {json.loads(line)["answer_id"] for line in raw.open()} if raw.exists() else set()
        todo = [r for r in q["answers"] if r["answer_id"] not in done]
        print(f"{q['id']}: {len(todo)} to run ({len(done)} already done)")

        def work(row, q=q, raw=raw):
            rec = run_answer(q, row)
            with lock, raw.open("a") as f:
                f.write(json.dumps(rec, ensure_ascii=False) + "\n")
            errors = [k for k in ("primary", "escalation", "llm_only", "evidence") if "error" in rec[k]]
            print(f"  {row['answer_id']}" + (f"  errors: {errors}" if errors else ""))

        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            list(pool.map(work, todo))
    print(f"run saved to {out}\nnext: uv run python scripts/run_eval.py analyze --run {out}")


# ---------- analyze ----------

def _skip_pred(item: dict):
    """What a skipped cell (gate said off topic) effectively recommends: no credit."""
    return False if item["type"] == "noul" else 0 if item["type"] == "score" else None


def _cost(rec: dict, role: str) -> float:
    u = rec.get("usage", {})
    if role == "primary":
        return u.get("input_tokens", 0) * PRICE["primary_input"] / 1e6
    output = u.get("output_tokens", 0) + u.get("thought_tokens", 0)
    return (u.get("input_tokens", 0) * PRICE["secondary_input"] + output * PRICE["secondary_output"]) / 1e6


def build_cells(questions: list[dict], run_dir: Path) -> tuple[list[dict], list[dict]]:
    cells, answers = [], []
    for q in questions:
        raw_file = run_dir / "raw" / f"{q['id']}.jsonl"
        if not raw_file.exists():
            continue
        raws = {r["answer_id"]: r for r in map(json.loads, raw_file.open())}
        items = {i["key"]: i for i in q["items"]}
        for row in q["answers"]:
            rec = raws.get(row["answer_id"])
            if rec is None:
                continue
            by = {part: {j["question_id"]: j for j in rec[part]["judgments"]} for part in
                  ("primary", "escalation", "llm_only", "evidence")}
            answers.append({
                "question": q["id"],
                "answer_id": row["answer_id"],
                "cost_primary": _cost(rec["primary"], "primary"),
                "cost_escalation": _cost(rec["escalation"], "secondary"),
                "cost_llm_only": _cost(rec["llm_only"], "secondary"),
                "cost_evidence": _cost(rec["evidence"], "secondary"),
                "latency_primary": rec["primary"]["latency"],
                "latency_escalation": rec["escalation"]["latency"],
                "latency_llm_only": rec["llm_only"]["latency"],
                "latency_evidence": rec["evidence"]["latency"],
                "escalated": len(rec["escalation"]["judgments"]) > 0,
            })
            gate = by["primary"].get(GATE)
            off_topic = GATE in items and parse_label(row.get(GATE), items[GATE]) is False
            for key, item in items.items():
                # the grader judged the answer off topic: every other item scores 0 anyway, so only the gate counts
                label = None if off_topic and key != GATE else parse_label(row.get(key), item)
                p = by["primary"].get(key, {})
                cells.append({
                    "question": q["id"],
                    "answer_id": row["answer_id"],
                    "answer_type": row.get("type", ""),
                    "key": key,
                    "item_type": item["type"],
                    "kind": item["kind"],
                    "label": label,
                    "primary_pred": p.get("pred"),
                    "conf": p.get("conf"),
                    "confident": p.get("confident", False),
                    "skipped": p.get("skipped", False),
                    "gate_pred": gate.get("pred") if gate else None,
                    "gate_conf": gate.get("conf") if gate else None,
                    "escalation_pred": by["escalation"].get(key, {}).get("pred"),
                    "llm_pred": by["llm_only"].get(key, {}).get("pred"),
                    "evidence_pred": by["evidence"].get(key, {}).get("pred"),
                    "evidence_quotes": len(by["evidence"].get(key, {}).get("evidence") or []),
                    "skip_pred": _skip_pred(item),
                })
    return cells, answers


def route(cell: dict, secondary_pred=None, t: float | None = None) -> tuple[str, object]:
    """Hybrid route and recommendation. With `t`, re-decide confidence at that threshold (sweep)."""
    if t is None:
        skipped, confident, second = cell["skipped"], cell["confident"], cell["escalation_pred"]
    else:
        gate_off = cell["gate_pred"] is False and (cell["gate_conf"] or 0) >= t
        skipped = gate_off and cell["key"] != GATE
        confident = cell["conf"] is not None and cell["conf"] >= t
        second = secondary_pred
    if skipped:
        return "skip", cell["skip_pred"]
    if confident:
        return "auto", cell["primary_pred"]
    if second is not None and second == cell["primary_pred"]:
        return "llm", second
    return "human", None


def _acc(pairs: list[tuple[object, object]]) -> float | None:
    return sum(p == lab for p, lab in pairs) / len(pairs) if pairs else None


def metrics(cells: list[dict]) -> dict:
    labeled = [c for c in cells if c["label"] is not None]
    routed = [(c, *route(c)) for c in labeled]
    covered = [(pred, c["label"]) for c, r, pred in routed if r != "human"]
    by_route = {}
    for c, r, pred in routed:
        by_route.setdefault(r, []).append((pred, c["label"]))
    n = len(labeled)
    covered_correct = sum(p == lab for p, lab in covered)
    return {
        "cells": n,
        "hybrid_final_acc": (covered_correct + len(by_route.get("human", []))) / n if n else None,
        "llm_only_acc": _acc([(c["llm_pred"], c["label"]) for c in labeled]),
        "primary_only_acc": _acc([(c["skip_pred"] if c["skipped"] else c["primary_pred"], c["label"]) for c in labeled]),
        "hybrid_coverage": len(covered) / n if n else None,
        "hybrid_acc_covered": _acc(covered),
        "hybrid_human_cells": len(by_route.get("human", [])),
        "routes": {r: {"cells": len(v), "acc": None if r == "human" else _acc(v)} for r, v in sorted(by_route.items())},
    }


def sweep(cells: list[dict]) -> list[dict]:
    labeled = [c for c in cells if c["label"] is not None]
    rows = []
    for step in range(0, 21):
        t = step / 20
        routed = [(c, *route(c, secondary_pred=c["llm_pred"], t=t)) for c in labeled]  # LLM-only stands in
        covered = [(pred, c["label"]) for c, r, pred in routed if r != "human"]
        auto = [1 for _, r, _ in routed if r in ("auto", "skip")]
        rows.append({
            "threshold": t,
            "auto_rate": len(auto) / len(labeled),
            "coverage": len(covered) / len(labeled),
            "acc_covered": _acc(covered),
            "escalated_rate": 1 - len(auto) / len(labeled),
        })
    return rows


def calibration(cells: list[dict]) -> list[dict]:
    bins = [0, 0.2, 0.4, 0.6, 0.8, 1.0001]
    rows = []
    for lo, hi in zip(bins, bins[1:]):
        inside = [c for c in cells if c["label"] is not None and not c["skipped"] and c["conf"] is not None
                  and lo <= c["conf"] < hi]
        rows.append({"conf_bin": f"{lo:.1f}-{min(hi, 1):.1f}", "cells": len(inside),
                     "acc": _acc([(c["primary_pred"], c["label"]) for c in inside])})
    return rows


def _fmt(x, pct=False) -> str:
    if x is None:
        return "-"
    return f"{x * 100:.1f}%" if pct else (f"{x:.4f}" if isinstance(x, float) else str(x))


def analyze(args) -> None:
    run_dir = Path(args.run)
    meta = json.loads((run_dir / "meta.json").read_text())
    questions = load_questions(run_dir.parent.parent, meta["questions"])
    cells, answers = build_cells(questions, run_dir)
    if not cells:
        raise SystemExit("no raw results in this run")

    overall = metrics(cells)
    per_q = {q["id"]: metrics([c for c in cells if c["question"] == q["id"]]) for q in questions}
    curve, calib = sweep(cells), calibration(cells)

    def mean(key):
        return statistics.mean(a[key] for a in answers)

    hybrid_latency = [a["latency_primary"] + a["latency_escalation"] for a in answers]
    ev = [c for c in cells if c["evidence_pred"] is not None]
    quoted = sum(c["evidence_quotes"] > 0 for c in ev) / len(ev) if ev else None
    ev_disagree = sum(c["evidence_pred"] != c["primary_pred"] for c in ev) / len(ev) if ev else None
    cost = {
        "(a) judgment: hybrid": sum(a["cost_primary"] + a["cost_escalation"] for a in answers),
        "(a) judgment: LLM only": sum(a["cost_llm_only"] for a in answers),
        "(b) evidence (every answer opened)": sum(a["cost_evidence"] for a in answers),
    }
    cost["(c) hybrid total"] = cost["(a) judgment: hybrid"] + cost["(b) evidence (every answer opened)"]

    lines = [
        f"# Evaluation {meta['run_id']}",
        "",
        f"primary `{meta['primary_model']}`, secondary `{meta['secondary_model']}`, commit `{meta['git_commit']}`, "
        f"{len(answers)} answers, {overall['cells']} labeled cells",
        "",
        "## Accuracy",
        "",
        "| | LLM only | decision model only | hybrid coverage | hybrid acc (covered) | cells left to grader "
        "| hybrid final (grader decides those) |",
        "|---|---|---|---|---|---|---|",
    ]
    for name, m in [("all", overall), *per_q.items()]:
        lines.append(f"| {name} | {_fmt(m['llm_only_acc'], True)} | {_fmt(m['primary_only_acc'], True)} | "
                     f"{_fmt(m['hybrid_coverage'], True)} | {_fmt(m['hybrid_acc_covered'], True)} | "
                     f"{m['hybrid_human_cells']} | {_fmt(m['hybrid_final_acc'], True)} |")
    lines += ["", "Labels of non-gate items are ignored for answers the grader judged off topic.",
              "", "Hybrid by route (human: no recommendation, the grader decides):", "",
              "| route | cells | acc |", "|---|---|---|"]
    lines += [f"| {r} | {v['cells']} | {_fmt(v['acc'], True)} |" for r, v in overall["routes"].items()]
    lines += ["", "## Cost (USD, whole set)", "", "| | total | per answer |", "|---|---|---|"]
    lines += [f"| {k} | {v:.4f} | {v / len(answers):.5f} |" for k, v in cost.items()]
    lines += [
        "", "## Latency per answer (s)", "", "| | mean | median | max |", "|---|---|---|---|",
        *[f"| {name} | {statistics.mean(v):.2f} | {statistics.median(v):.2f} | {max(v):.2f} |" for name, v in [
            ("hybrid: first recommendation (decision model)", [a["latency_primary"] for a in answers]),
            ("hybrid: all cells done (with escalation)", hybrid_latency),
            ("LLM only", [a["latency_llm_only"] for a in answers]),
            ("evidence lookup (on open)", [a["latency_evidence"] for a in answers]),
        ]],
        "", "## Evidence lookup (display only)", "",
        f"{len(ev)} confident cells looked up; {_fmt(quoted, True)} got at least one verified quote; "
        f"{_fmt(ev_disagree, True)} where the lookup's judgment differed from the decision model "
        f"(shown to graders as a note)",
        "", f"Answers with an escalation: {sum(a['escalated'] for a in answers)}/{len(answers)}; "
        f"mean decision-model cost {mean('cost_primary'):.6f} USD/answer",
        "", "## Threshold sweep (one threshold for every question type; escalations approximated by LLM-only judgments)",
        "", "| threshold | auto | coverage | acc (covered) |", "|---|---|---|---|",
        *[f"| {r['threshold']:.2f} | {_fmt(r['auto_rate'], True)} | {_fmt(r['coverage'], True)} | "
          f"{_fmt(r['acc_covered'], True)} |" for r in curve],
        "", "## Calibration (decision model, non-skipped cells)", "", "| confidence | cells | acc |", "|---|---|---|",
        *[f"| {r['conf_bin']} | {r['cells']} | {_fmt(r['acc'], True)} |" for r in calib],
        "",
    ]
    (run_dir / "summary.md").write_text("\n".join(lines))

    with (run_dir / "cells.csv").open("w", newline="", encoding="utf-8-sig") as f:
        rows = [c | {"hybrid_route": route(c)[0], "hybrid_pred": route(c)[1]} for c in cells]
        writer = csv.DictWriter(f, fieldnames=list(rows[0]))
        writer.writeheader()
        writer.writerows(rows)
    for name, rows in [("curve.csv", curve), ("calibration.csv", calib)]:
        with (run_dir / name).open("w", newline="") as f:
            writer = csv.DictWriter(f, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)

    plot(run_dir, curve, calib, cost)
    print((run_dir / "summary.md").read_text())


COST_LABEL = {
    "(a) judgment: hybrid": "(a) 판단: 하이브리드",
    "(a) judgment: LLM only": "(a) 판단: LLM 단독",
    "(b) evidence (every answer opened)": "(b) 근거 찾기 (모든 답안을 열 때)",
    "(c) hybrid total": "(c) 하이브리드 합계",
}


def plot(run_dir: Path, curve: list[dict], calib: list[dict], cost: dict) -> None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
    except ImportError:
        print("matplotlib not installed: skipped figures (uv add --dev matplotlib)")
        return

    # Korean labels for the report: first installed font wins
    plt.rcParams["font.family"] = ["Noto Sans KR", "Apple SD Gothic Neo", "Malgun Gothic", "NanumGothic", "sans-serif"]
    plt.rcParams["axes.unicode_minus"] = False

    fig, ax = plt.subplots(figsize=(6, 4))
    ts = [r["threshold"] for r in curve]
    ax.plot(ts, [r["auto_rate"] for r in curve], label="자동 처리율")
    ax.plot(ts, [r["acc_covered"] or 0 for r in curve], label="정확도 (추천이 나온 칸)")
    ax.plot(ts, [r["coverage"] for r in curve], label="추천 범위", linestyle="--")
    ax.set_xlabel("확신 임계값")
    ax.set_ylim(0, 1.02)
    ax.legend()
    fig.tight_layout()
    fig.savefig(run_dir / "fig_threshold.png", dpi=200)

    fig, ax = plt.subplots(figsize=(5, 4))
    filled = [r for r in calib if r["cells"]]
    ax.bar([r["conf_bin"] for r in filled], [r["acc"] for r in filled])
    for i, r in enumerate(filled):
        ax.text(i, r["acc"] + 0.01, f"n={r['cells']}", ha="center", fontsize=8)
    ax.set_xlabel("판단 모델 확신도")
    ax.set_ylabel("정확도")
    ax.set_ylim(0, 1.1)
    fig.tight_layout()
    fig.savefig(run_dir / "fig_calibration.png", dpi=200)

    fig, ax = plt.subplots(figsize=(6, 3))
    ax.barh([COST_LABEL.get(k, k) for k in cost], list(cost.values()))
    ax.set_xlabel("USD (평가셋 전체)")
    fig.tight_layout()
    fig.savefig(run_dir / "fig_cost.png", dpi=200)
    plt.close("all")


def main() -> None:
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run")
    r.add_argument("--set", default=str(DEFAULT_SET))
    r.add_argument("--questions", help="comma-separated question ids (default: all)")
    r.add_argument("--workers", type=int, default=2)
    r.add_argument("--resume", help="run id to continue")
    a = sub.add_parser("analyze")
    a.add_argument("--run", required=True)
    args = parser.parse_args()
    run(args) if args.cmd == "run" else analyze(args)


if __name__ == "__main__":
    main()
