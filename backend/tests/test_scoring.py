import pytest

from app.models import RubricItem
from app.scoring import item_points, max_total, total

GATE = RubricItem(kind="gate", type="noul")
CREDIT = RubricItem(kind="credit", type="noul", points=2)
SCORE = RubricItem(kind="credit", type="score", points_map={"0": 0, "1": 1, "2": 3})
CHOICE = RubricItem(kind="credit", type="choice", points_map={"a": 1, "b": 0})
DEDUCTION = RubricItem(kind="deduction", type="noul", points=1)


@pytest.mark.parametrize(
    "item, pred, expected",
    [
        (GATE, True, 0),
        (GATE, False, 0),
        (CREDIT, True, 2),
        (CREDIT, False, 0),
        (SCORE, 2, 3),
        (CHOICE, "a", 1),
        (DEDUCTION, True, -1),
        (DEDUCTION, False, 0),
        (CREDIT, None, None),
    ],
)
def test_item_points(item, pred, expected):
    assert item_points(item, pred) == expected


def test_gate_failed_zeroes_items():
    assert item_points(CREDIT, True, gate_passed=False) == 0
    assert item_points(DEDUCTION, True, gate_passed=False) == 0


def test_total():
    assert total([2, -1, 3]) == 4
    assert total([0, -1]) == 0  # floored at 0
    assert total([1, None]) is None


def test_max_total():
    assert max_total([GATE, CREDIT, SCORE, CHOICE, DEDUCTION]) == 6
