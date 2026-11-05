import pytest

from app.redact import redact


@pytest.mark.parametrize(
    "text, expected",
    [
        ("학번: 20231234  이름: 김민수\n역전파는", "[식별 정보]\n역전파는"),
        ("성명：홍길동\n답", "[식별 정보]\n답"),
        ("제출자 20231234 입니다", "제출자 [학번] 입니다"),
        ("학번20231234", "학번[학번]"),
        ("메일 kim.ms@univ.ac.kr 로", "메일 [이메일] 로"),
        ("연락처 010-1234-5678", "연락처 [전화번호]"),
        ("배치 크기 1024, 학습률 0.001", "배치 크기 1024, 학습률 0.001"),  # ordinary numbers stay
    ],
)
def test_patterns(text, expected):
    assert redact(text) == expected


def test_known_values():
    assert redact("김민수가 작성한 답안", ["S1", "김민수", None, " "]) == "[식별 정보]가 작성한 답안"
