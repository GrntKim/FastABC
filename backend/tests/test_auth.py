import pytest

from app.models import AuthSession
from tests.test_grading import grading  # noqa: F401  (fixture)
from tests.test_review import graded  # noqa: F401  (fixture)

ACCOUNT = {"email": "New@Example.com", "name": " 박교수 ", "password": "long enough"}


def test_signup_logs_in(anon):
    r = anon.post("/auth/signup", json=ACCOUNT)
    assert r.status_code == 201
    assert r.json() | {"id": 0} == {"id": 0, "email": "new@example.com", "name": "박교수"}
    cookie = r.headers["set-cookie"].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie
    assert anon.get("/auth/me").json()["name"] == "박교수"


def test_signup_refuses_taken_email_and_short_password(anon):
    anon.post("/auth/signup", json=ACCOUNT)
    assert anon.post("/auth/signup", json=ACCOUNT | {"email": "new@example.com"}).status_code == 409
    assert anon.post("/auth/signup", json=ACCOUNT | {"email": "x@example.com", "password": "short"}).status_code == 422
    assert anon.post("/auth/signup", json=ACCOUNT | {"email": "not-an-email"}).status_code == 422


def test_login_and_logout(anon, db):
    anon.post("/auth/signup", json=ACCOUNT)
    anon.post("/auth/logout")
    assert anon.get("/auth/me").status_code == 401

    assert anon.post("/auth/login", json={"email": "new@example.com", "password": "wrong one"}).status_code == 401
    assert anon.post("/auth/login", json={"email": "nobody@example.com", "password": "long enough"}).status_code == 401
    r = anon.post("/auth/login", json={"email": " NEW@example.com", "password": "long enough"})
    assert r.status_code == 200
    assert anon.get("/auth/me").status_code == 200

    anon.post("/auth/logout")
    assert db.query(AuthSession).count() == 0  # the session is gone, not only the cookie


def test_only_the_token_hash_is_stored(anon, db):
    r = anon.post("/auth/signup", json=ACCOUNT)
    token = r.cookies["fastabc_session"]
    assert db.query(AuthSession).one().token_hash != token


@pytest.mark.parametrize(
    "method,path",
    [("get", "/courses"), ("get", "/assignments"), ("get", "/assignments/1"), ("post", "/rubric-drafts")],
)
def test_login_required(anon, method, path):
    assert getattr(anon, method)(path).status_code == 401


def test_others_see_nothing(client, stranger, graded):  # noqa: F811
    aid = graded["aid"]
    course_id = client.get(f"/assignments/{aid}").json()["course_id"]
    cell = next(iter(graded["cells"].values()))

    assert stranger.get("/courses").json() == []
    assert stranger.get("/assignments").json() == []
    for path in (f"/courses/{course_id}", f"/assignments/{aid}", f"/assignments/{aid}/cells", f"/assignments/{aid}/export.csv"):
        assert stranger.get(path).status_code == 404, path
    assert stranger.patch(f"/grades/{cell['grade_id']}", json={"action": "accept"}).status_code == 404
    assert stranger.post(f"/submissions/{cell['submission_id']}/evidence").status_code == 404
    assert stranger.delete(f"/submissions/{cell['submission_id']}").status_code == 404
    assert stranger.post(f"/assignments/{aid}/accept-confident").status_code == 404
    assert stranger.delete(f"/courses/{course_id}").status_code == 404
    # nor can they file an assignment under someone else's course
    body = {"course_id": course_id, "title": "t", "problem": "p", "items": []}
    assert stranger.post("/assignments", json=body).status_code == 422

    assert client.get(f"/assignments/{aid}").status_code == 200  # still there for its owner


def test_same_course_names_for_different_graders(client, stranger, course_id):
    body = {"department": "컴퓨터공학과", "term": "2026-2", "name": "딥러닝개론", "section": "01"}
    assert stranger.post("/courses", json=body).status_code == 201
    assert client.post("/courses", json=body).status_code == 409


def test_sign_off_names_the_logged_in_grader(client, graded):  # noqa: F811
    aid = graded["aid"]
    client.post(f"/assignments/{aid}/accept-confident")
    for cell in client.get(f"/assignments/{aid}/cells").json():
        if cell["final_points"] is None:
            client.patch(f"/grades/{cell['grade_id']}", json={"action": "set", "points": 0})
    r = client.post(f"/assignments/{aid}/finalizations", json={"confirmed": True})
    assert r.status_code == 201, r.text
    assert r.json()["finalized_by"] == "김조교"
