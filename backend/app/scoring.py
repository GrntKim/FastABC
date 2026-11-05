"""Scoring rules: judgments to points. Rules are code, not model output (CLAUDE.md design principle 3)."""

from app.models import ItemKind, ItemType, RubricItem


def item_points(item: RubricItem, pred: bool | int | str | None, gate_passed: bool = True) -> float | None:
    """Points for one cell, or None if there is no judgment to score."""
    if item.kind == ItemKind.GATE:
        return 0.0
    if not gate_passed:
        return 0.0
    if pred is None:
        return None
    if item.kind == ItemKind.DEDUCTION:
        return -(item.points or 0.0) if pred else 0.0
    if item.type == ItemType.NOUL:
        return (item.points or 0.0) if pred else 0.0
    return (item.points_map or {}).get(str(pred), 0.0)


def total(points: list[float | None]) -> float | None:
    """Submission total, floored at 0. None while any cell is undecided."""
    if any(p is None for p in points):
        return None
    return max(0.0, sum(points))


def max_total(items: list[RubricItem]) -> float:
    total_max = 0.0
    for item in items:
        if item.kind != ItemKind.CREDIT:
            continue
        if item.type == ItemType.NOUL:
            total_max += item.points or 0.0
        else:
            total_max += max((item.points_map or {}).values(), default=0.0)
    return total_max


def point_range(item: RubricItem) -> tuple[float, float]:
    """Points a grader may give for one cell."""
    if item.kind == ItemKind.GATE:
        return 0.0, 0.0
    if item.kind == ItemKind.DEDUCTION:
        return -(item.points or 0.0), 0.0
    if item.type == ItemType.NOUL:
        return 0.0, item.points or 0.0
    values = (item.points_map or {}).values()
    return min(values, default=0.0), max(values, default=0.0)
