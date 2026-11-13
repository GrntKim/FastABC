from app.drafting import DraftItem, DraftTopic, RubricDraft, to_items
from app.grading import get_drafter
from app.main import app as fastapi_app
from tests.test_assignments import make_body

TOPIC = DraftTopic(
    instructions="`answer`가 `question`의 주제인 역전파를 설명하려고 시도한다.", criteria_true="t", criteria_false="f"
)


def noul(key="mentions_chain_rule", label="연쇄법칙 언급", kind="credit", points=2.0, **kw) -> DraftItem:
    fields = dict(key=key, label=label, type="noul", kind=kind, instructions="`answer`가 …한다.",
                  criteria_true="참", criteria_false="거짓", levels=[], level_points=[], points=points)
    return DraftItem(**(fields | kw))


def score(levels=("없음", "일부", "대체로", "완전"), level_points=(0, 1, 2, 4), **kw) -> DraftItem:
    fields = dict(key="accuracy", label="설명 정확도", type="score", kind="credit", instructions="`answer`의 … 얼마나?",
                  criteria_true="", criteria_false="", levels=list(levels), level_points=list(level_points), points=0)
    return DraftItem(**(fields | kw))


def test_to_items():
    items, warnings = to_items(RubricDraft(topic=TOPIC, items=[noul(), score(), noul("misc_x", "오개념: x", "deduction", 1)]))
    assert warnings == []
    gate, chain, accuracy, misc = items
    assert (gate["key"], gate["kind"], gate["descriptions"]) == ("is_on_topic", "gate", {"true": "t", "false": "f"})
    assert (chain["points"], chain["descriptions"]) == (2, {"true": "참", "false": "거짓"})
    assert accuracy["points_map"] == {"0": 0, "1": 1, "2": 2, "3": 4} and accuracy["descriptions"][3] == "완전"
    assert (misc["kind"], misc["points"]) == ("deduction", 1)


def test_to_items_repairs():
    draft = RubricDraft(topic=TOPIC, items=[
        noul(key="Chain Rule!"),
        noul(key="chain_rule", points=0, criteria_false=""),
        noul(key="is_on_topic"),
        noul(key="1st"),
        score(level_points=(0, 2)),
        score(key="kind_of", levels=("only one",), level_points=(3,)),
        score(key="minus", kind="deduction"),
    ])
    items, warnings = to_items(draft)
    assert [i["key"] for i in items] == [
        "is_on_topic", "chain_rule", "chain_rule_2", "is_on_topic_2", "item_1st", "accuracy", "kind_of", "minus"]
    assert (items[2]["points"], items[2]["descriptions"]) == (1, None)  # no points -> 1, half-empty criteria dropped
    assert items[5]["points_map"] == {"0": 0, "1": 2, "2": 2, "3": 3}  # missing level points -> level number
    assert (items[6]["type"], items[6]["points"]) == ("noul", 3)  # a single level is a yes/no item
    assert items[7]["kind"] == "credit"
    assert len(warnings) == 4


class FakeDrafter:
    def __init__(self, draft=None, error=None):
        self.result, self.error = draft, error

    def draft(self, problem, rubric_text):
        if self.error:
            raise self.error
        return self.result


def test_endpoint_and_save(client, course_id):
    fastapi_app.dependency_overrides[get_drafter] = lambda: FakeDrafter(RubricDraft(topic=TOPIC, items=[noul(), score()]))
    r = client.post("/rubric-drafts", json={"problem": "p", "rubric_text": "연쇄법칙 2점, 정확도 0~4점"})
    assert r.status_code == 200
    assert (len(r.json()["items"]), r.json()["problems"]) == (3, [])

    body = make_body(course_id) | {"items": r.json()["items"]}  # the draft saves as-is
    assert client.post("/assignments", json=body).status_code == 201


def test_endpoint_reports_problems_and_failures(client):
    bad = RubricDraft(topic=TOPIC, items=[noul(label="x" * 150)])
    fastapi_app.dependency_overrides[get_drafter] = lambda: FakeDrafter(bad)
    problems = client.post("/rubric-drafts", json={"problem": "p", "rubric_text": "t"}).json()["problems"]
    assert len(problems) == 1 and problems[0].startswith("2번 항목")

    fastapi_app.dependency_overrides[get_drafter] = lambda: FakeDrafter(error=RuntimeError("quota"))
    assert client.post("/rubric-drafts", json={"problem": "p", "rubric_text": "t"}).status_code == 502
    assert client.post("/rubric-drafts", json={"problem": "p", "rubric_text": ""}).status_code == 422
