from app.grading import Judges, get_judges
from app.main import app as fastapi_app
from tests.test_finalizations import SIGN, decided  # noqa: F401  (fixture)
from tests.test_grading import FakePrimary, FakeSecondary, grading  # noqa: F401  (fixture)
from tests.test_review import graded  # noqa: F401  (fixture)

AGREES = {"mentions_chain_rule": True, "mentions_weight_update": True, "accuracy": 3}


def test_report_waits_for_sign_off(client, decided):  # noqa: F811
    aid = decided["aid"]
    assert client.get(f"/assignments/{aid}/report").status_code == 409
    assert client.post(f"/assignments/{aid}/report/evidence").status_code == 409


def test_report_quotes_only_what_the_grader_confirmed(client, decided):  # noqa: F811
    aid, cells = decided["aid"], decided["cells"]
    assert client.post(f"/assignments/{aid}/finalizations", json=SIGN).status_code == 201
    items = {i["key"]: i["id"] for i in client.get(f"/assignments/{aid}").json()["items"]}

    # quotes for the answers nobody opened, only where points were given or taken
    evidence = FakeSecondary({"a": AGREES, "b": AGREES})
    fastapi_app.dependency_overrides[get_judges] = lambda: Judges(FakePrimary(), FakeSecondary(), evidence=evidence)
    assert client.post(f"/assignments/{aid}/report/evidence").json() == {"requested": 5}
    assert sorted(len(q) for _, q in evidence.calls) == [2, 3]
    assert client.post(f"/assignments/{aid}/report/evidence").json() == {"requested": 0}

    r = client.get(f"/assignments/{aid}/report").json()
    assert r["finalization"]["version"] == 1
    a, b = r["students"]
    assert (a["student_ref"], a["total"], a["off_topic"]) == ("20230000", 8, False)
    by = {k: next(x for x in a["items"] if x["rubric_item_id"] == i) for k, i in items.items() if k != "is_on_topic"}
    assert by["mentions_chain_rule"] == {"rubric_item_id": items["mentions_chain_rule"], "points": 2, "by_grader": False, "quotes": ["근거"]}
    assert by["misc_is_optimizer"]["quotes"] == []  # no points either way: nothing to explain

    # set by the grader against the re-judgment: the points stand without the judge's words
    misc = next(x for x in b["items"] if x["rubric_item_id"] == items["misc_is_optimizer"])
    assert (misc["points"], misc["by_grader"], misc["quotes"]) == (-1, True, [])
    assert cells["b", "misc_is_optimizer"]["secondary"]["evidence"] == ["근거"]

    one = client.get(f"/assignments/{aid}/report", params={"student_ref": "20230001"}).json()["students"]
    assert [s["student_ref"] for s in one] == ["20230001"]


def test_others_cannot_read_reports(client, stranger, decided):  # noqa: F811
    aid = decided["aid"]
    client.post(f"/assignments/{aid}/finalizations", json=SIGN)
    assert stranger.get(f"/assignments/{aid}/report").status_code == 404
    assert stranger.post(f"/assignments/{aid}/report/evidence").status_code == 404
