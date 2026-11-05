# CLAUDE.md — FastABC 프로젝트 컨텍스트

이 문서는 Claude Code가 FastABC 저장소에서 작업할 때 따라야 할 프로젝트 배경, 설계 결정, 작업 규칙을 담고 있습니다. 작업을 시작하기 전에 전체를 읽어주세요.

---

## 0. 작업 규칙 (가장 중요)

다음 규칙은 다른 모든 지시보다 우선합니다.

1. **파일 생성·수정은 요청이 있을 때만 합니다.**
   - 사용자가 명시적으로 "만들어줘", "수정해줘", "파일로 작성해줘"처럼 요청한 경우에만 파일을 생성하거나 수정합니다.
   - 요청받은 파일 외의 파일은 건드리지 않습니다. 작업 중 다른 파일도 바꿔야 할 것 같으면, 바꾸지 말고 어떤 파일을 왜 바꿔야 하는지 먼저 말로 설명하고 확인을 받습니다.
   - "편의상", "정리 차원에서" 파일을 추가하거나 구조를 바꾸지 않습니다.
2. **그 외에는 말로 설명합니다.**
   - 설계 제안, 구현 방법, 코드 예시는 대화 안에서 설명과 코드 블록으로 제시합니다.
   - 사용자가 제안을 보고 판단한 뒤 파일 작업을 요청합니다.
3. **패키지 설치, git 작업도 요청이 있을 때만 합니다.**
   - `uv add`, `pnpm add`, `git commit`, `git push` 등은 필요한 명령어를 설명만 하고, 실행 요청을 받으면 실행합니다.
   - 커밋 메시지는 영어 접두사(`feat:`, `fix:`, `chore:` 등) 기반 한 줄. 본문·`Co-Authored-By` 없음. `main`에 직접 커밋.
4. **추측하지 말고 확인합니다.**
   - 외부 API 스펙은 공식 문서로 확인합니다. 아래 기록은 확인 시점 기준이며 바뀔 수 있습니다.
5. **답변은 한국어로 합니다.** 코드, 커밋 메시지, 식별자는 영어로 씁니다.

---

## 1. 프로젝트 개요

- **이름:** FastABC (FastAPI에서 착안, 빠르게 A·B·C를 매긴다는 뜻)
- **한 줄 설명:** 명확한 판단은 빠른 판단형 AI가, 모호한 판단은 LLM이 맡아 추천 점수와 근거를 제시하고, 최종 점수는 채점자가 확정하는 서술형 답안 채점 보조 시스템
- **대상 사용자:** 대학 교수·조교
- **성격:** CS학과 1인 졸업작품. 완벽한 상용 서비스보다 **혼자서 끝까지 동작하는 완전한 애플리케이션**을 만드는 것이 목표
- **일정:** 2026-10-15 기준 보고서 포함 약 5주. 파트타임으로 진행
- **라이선스:** MIT

---

## 2. 설계 원칙

1. **AI는 추천만, 확정은 사람이.** 시스템은 항목별 추천 점수, 확신도(%), 근거 문장만 제시합니다. 모든 점수의 최종 확정은 채점자가 합니다.
2. **판단 단위는 "채점 기준 항목".** 답안을 문장 단위로 쪼개지 않습니다. 답안 전체를 입력 상태로 두고, 채점 기준의 각 항목을 판단 질문으로 바꿔 한 번에 병렬 평가합니다.
3. **판단은 decision model, 생성은 LLM, 규칙은 코드.**
   - 판단형 AI: 항목별 1차 판단과 확신도
   - LLM: 확신도가 낮은 항목의 재판단과 근거 생성, 채점 기준 초안 생성
   - 코드: 점수 합산, Pass/Fail 판정, 임계값 분기, 라우팅
4. **AI 생성 답안 여부는 판정하지 않습니다.** 퍼센트 수치도 표시하지 않습니다. 대신 관찰 가능한 이상 신호(예: 학생 간 답안 유사도)만 근거와 함께 참고 정보로 표시하고, 점수에는 반영하지 않습니다.
5. **자동화 편향 방지 UI.** 점수 칸을 추천값으로 미리 채우지 않습니다. 채점자가 직접 입력하거나 "추천 수용"을 눌러야 채워집니다. 일괄 수용은 고확신 항목에만 허용합니다.
6. **수용/수정 로그를 남깁니다.** 항목별로 채점자가 추천을 수용했는지 수정했는지 기록합니다. 평가 지표와 향후 임계값 보정에 씁니다.

---

## 3. 판단 파이프라인

```
문제·채점 기준 입력 ─(기준 없음)→ LLM 초안 생성 → 채점자 확정
        ↓
채점 기준 → 항목별 판단 질문 스키마로 변환 (+ 게이트 질문 is_on_topic)
        ↓
답안 업로드 및 텍스트 추출 (타이핑 답안만, 손글씨 OCR은 범위 밖)
        ↓
식별 정보 제거
        ↓
Jev 병렬 판단 (답안 1건 = 요청 1회, 항목 전부 포함)
        ↓
 ├─ 게이트 False      → skip: 나머지 항목 판단 생략
 ├─ 확신도 ≥ 임계값   → auto: Jev 판단을 추천
 ├─ 확신도 < 임계값   → Gemini 재판단 (에스컬레이션 항목만)
 │    ├─ 두 판단 일치 → llm: 추천 + Gemini 근거
 │    └─ 불일치·실패  → human: 추천 없음, 채점자 직접 판단 (Gemini 근거는 참고용)
        ↓
채점자 검토 및 확정 → 코드로 최종 점수 산출 → 로그 저장
```

라우팅 구현: `backend/app/judges/routing.py` (`Route`: skip / auto / llm / human, `grade()`).

---

## 4. 판단형 AI: Jev (2026-10 공식 문서·실측으로 확인)

- 개발사: TypeSafe AI. 텍스트를 생성하지 않고 구조화된 판단과 확률만 반환하는 "System One" 모델. 문서: docs.typesafe.ai
- 엔드포인트: `POST https://api.typesafe.ai/v1/systemone`, `Authorization: Bearer <TYPESAFE_API_KEY>`
- 요청 본문: `{"state": ..., "model": ..., "questions": {<id>: {"type", "instructions", "criteria"}}}`
  - `state`: `{"question": 문제, "answer": 답안}` 형태로 보냄
- 모델: `jev-latest` = 1.13.0, `jev-1.14.0`은 프리뷰. **코드에서는 `jev-1.13.0`으로 고정** (임계값이 모델 버전별로 다르기 때문)
- 응답 `answers[<id>]` 형식 (값은 소수 둘째 자리로 반올림됨)
  - **noul:** `noul` = 참일 확률 p. **confidence 필드 없음** → 확신도는 `|2p − 1|`로 계산
  - **score:** `score`(가중 평균), `probabilities`(키는 문자열 "0","1",…), `confidence`, `legend`. 수준 2~10개
  - **choice:** `choice`, `probabilities`, `confidence`
- 한도: 요청당 64K 토큰, 질문당 32K 토큰. 429/529는 재시도 (`call_jev`)
- 가격: 입력 100만 토큰당 $0.042, 출력 무료
- 베타 서비스이므로 API 변경이나 중단 가능성이 있음

**실측 결과 (노트북 01, 문항 1개·답안 6개·36칸)**

- 영어·한국어 질문 모두 라벨 36/36 일치, 고확신 오판 0건
- 반복 호출 시 확신도 표준편차 < 0.07, 판단 뒤집힘은 p≈0.5 칸에서만
- 지연은 질문 1~16개에서 약 0.18초로 일정
- 한국어 질문은 경계 칸에서 확신도가 더 높게 나옴 → 평가셋에서 보정 확인 필요

**임계값 (잠정, 평가셋에서 재조정)**: `T_NOUL = 0.6` (p ≤ 0.2 또는 ≥ 0.8), `T_OTHER = 0.8`. 자동 처리율 86~94%.

**질문 설계 규칙**

- 게이트 질문 `is_on_topic`(noul)을 항상 포함. False면 나머지 항목 skip
- 오개념은 Choice 하나로 묶지 않고 오개념별 Noul 질문으로 분리

채점 기준과 질문 형식 대응 예시:

| 채점 기준 항목 | 질문 형식 |
|---|---|
| "역전파의 연쇄법칙을 언급했는가" | Noul |
| "설명의 정확도 0~3점" | Score (수준별 설명 포함) |
| "오개념 A를 포함하는가" | Noul (오개념마다 하나) |

---

## 5. LLM: Gemini (2026-11 확인)

- 모델: **`gemini-3.6-flash`** (Stable)로 고정. `gemini-2.5-flash`는 지원 종료 예정(2026-12-01에 3.5-flash-lite로 전환)이라 쓰지 않음
- SDK: `google-genai`, **Interactions API** 사용
  - `client.interactions.create(model, system_instruction, input, response_format={"type": "text", "mime_type": "application/json", "schema": ...}, store=False)`
  - 결과는 `interaction.output_text`, 사용량은 `usage.total_input_tokens` / `total_output_tokens` / `total_thought_tokens`
  - 키: SDK는 `GOOGLE_API_KEY`, 없으면 `GEMINI_API_KEY`를 읽음
- 가격: 입력 100만 토큰당 $0.75, 출력 $3.75 (thinking 토큰은 출력으로 과금). 2027-01-01부터 2배
- `thinking_level`: **기본값 유지**. `low`는 지연·비용이 절반이지만 가장 애매한 경계 칸에서 오판 (35/36). 에스컬레이션은 경계 칸만 받으므로 품질 우선
- **무료 등급은 입력이 학습에 쓰이고 사람이 검토할 수 있음 → 합성 데이터만.** 실제 학생 답안은 결제 계정이 연결된 프로젝트에서만 보냄
- 출력 형식 오류(예: noul에 `level` 반환)가 비결정적으로 발생 → 타입별 스키마 + 틀린 질문만 1회 재시도, 그래도 실패하면 `pred=None` → human
- 근거 인용은 `verify_evidence`로 원문에 있는 문장만 남김

**실측 결과 (노트북 02, 같은 36칸)**

| | 하이브리드 (Jev + 에스컬레이션) | Gemini 단독 |
|---|---|---|
| 라벨 일치 | 36/36 | 36/36 |
| 답안당 평균 지연 | 4.1초 | 8.0초 |
| 비용 (6답안) | $0.017 | $0.035 |

- 이 데이터에서 하이브리드의 이점은 정확도가 아니라 속도·비용
- `human` 경로는 아직 한 번도 발생하지 않음 → 평가셋에 경계 사례가 필요

---

## 6. 기술 스택과 결정 사항

| 영역 | 선택 | 비고 |
|---|---|---|
| Backend | FastAPI, uv | `backend/`, hatchling 빌드로 `app` 패키지 editable 설치 |
| Frontend | Next.js 16, pnpm, Tailwind CSS, shadcn/ui, TanStack Query | `frontend/` |
| DB | PostgreSQL, SQLAlchemy 2.x (sync), psycopg 3 | 스키마는 Alembic으로 백엔드에서 관리. 개발은 Docker `postgres:17`. Supabase(DB+Auth) 유지가 권장안, 호스팅은 4주차 배포 때 확정 |
| 인증 | Supabase Auth를 Next.js에서 처리, FastAPI는 JWT 검증만 | 우선순위 낮음. 4주차쯤 연결 |
| Decision model | Jev (REST, httpx로 직접 호출) | `app/judges/jev.py` |
| LLM | Gemini 3.6 Flash (Interactions API, 구조화 출력 JSON) | `app/judges/gemini.py` |
| 임베딩 | Gemini 임베딩 API | 학생 간 유사도 계산용 |
| 파일 파싱 | pypdf 또는 pdfplumber (PDF), python-docx (docx) | |
| 배포 | Frontend: Vercel / Backend: Cloud Run (asia-northeast3) | 모든 리전을 서울로 맞춤 |

**의도적으로 쓰지 않는 것 (제안하지 마세요)**

- **PyMuPDF:** AGPL 라이선스라 MIT 저장소와 충돌
- **pgvector:** 문항당 답안 수십 개 수준이라 numpy 코사인 유사도로 충분
- **Celery, Redis 등 작업 큐:** Jev는 빠르므로 동기 처리, LLM 에스컬레이션만 FastAPI `BackgroundTasks` + 프론트 폴링
- **LangChain:** 호출 패턴이 단순해서 불필요
- **프론트에서 supabase-js로 테이블 직접 접근:** 로그인 용도로만 쓰고, 데이터는 전부 FastAPI 경유
- **Cloudflare Workers 백엔드:** 패키지 호환성과 백그라운드 작업 문제로 이번 범위에서는 제외

**판단 엔진 인터페이스 (핵심 설계, `app/judges/base.py`)**

```python
Questions = dict[str, dict]  # Jev 요청 형식 그대로: {id: {"type", "instructions", "criteria"}}

@dataclass
class Judgment:
    question_id: str
    type: str                    # "noul" | "score" | "choice"
    pred: bool | int | str | None  # None: 유효한 판단 없음 → human
    conf: float | None = None    # Jev만. LLM 자기 보고 확신도는 쓰지 않음
    raw: float | dict[str, float] | None = None
    evidence: list[str] = []     # LLM만, 원문 그대로 인용
    reasoning: str | None = None # LLM만
    skipped: bool = False        # 게이트 False

class Judge(Protocol):
    def evaluate(self, problem: str, answer: str, questions: Questions) -> list[Judgment]: ...

class JevJudge: ...     # 1차 판단
class GeminiJudge: ...  # 에스컬레이션 + "LLM 단독" 베이스라인. Jev 결과를 보지 않음
```

판단 모델 교체 가능성 확보, 베이스라인 비교 실험, 보고서상 아키텍처 기여를 위해 이 구조를 유지합니다.

---

## 7. 저장소 구조 (현재)

```
.
├── LICENSE
├── README.md
├── CLAUDE.md
├── .env.example          # 키 이름만 (TYPESAFE_API_KEY, GEMINI_API_KEY, DATABASE_URL)
├── docker-compose.yml    # 로컬 개발용 postgres:17
├── .vscode/settings.json # backend/.venv 인터프리터 지정
├── data/
│   └── backprop_v1.json  # 실험용 문항·답안 6개·질문(ko/en)·라벨 (Claude 초안 라벨, 독립 라벨 아님)
├── backend/              # FastAPI, uv 프로젝트
│   ├── app/
│   │   ├── main.py
│   │   ├── db.py         # engine, SessionLocal, Base, get_db
│   │   ├── models.py     # assignments, rubric_items, submissions, judgments, grades
│   │   ├── scoring.py    # 점수 규칙 (gate / credit / deduction, 총점 0점 하한)
│   │   └── judges/       # base.py, jev.py, gemini.py, routing.py
│   ├── alembic/          # 마이그레이션 (alembic.ini는 backend/)
│   ├── notebooks/        # 01_jev_response_check, 02_gemini_escalation (outputs/는 gitignore)
│   ├── pyproject.toml
│   └── uv.lock
└── frontend/             # Next.js, pnpm
```

**계획된 구조 (사용자 요청 시에만 생성)**

```
backend/
├── app/              # routers/ 등 추가 예정
├── scripts/          # 재현 가능한 최종 평가 (run_eval.py)
└── ...
data/raw/, data/private/   # 외부 자료·비공개 파일 (gitignore)
```

**노트북 규칙**

- 노트북에서 검증된 로직은 `app/`으로 옮기고 노트북에서는 import해서 씁니다.
- nbstripout 필터가 설치되어 있어 커밋 시 출력이 자동으로 지워집니다.
- 파일명은 `01_`, `02_`처럼 번호를 붙입니다.
- `app` 모듈을 고친 뒤에는 커널을 재시작해야 반영됩니다.

**DB 결정**

- 상태값(type, kind, route 등)은 PG 네이티브 enum 대신 문자열 컬럼 + 앱의 `StrEnum`
- 원본 파일은 저장하지 않고 추출 텍스트만 저장. 외부 API에는 `submissions.clean_text`만 보냄
- `grades`는 칸당 1행, 확정 시 덮어쓰기 (이력 테이블 없음). 총점은 저장하지 않고 `scoring.py`로 계산
- 재채점은 기존 `judgments`·`grades`를 지우고 새로 생성. 확정된 칸이 있으면 막음
- PDF 추출 시 제어 문자는 공백으로, 줄바꿈은 추측해서 잇지 않음. 근거 인용 검증은 공백을 모두 무시하고 비교

**보안**

- API 키는 `.env`(저장소 루트)에만 두고 커밋하지 않습니다. `.env.example`에는 키 이름만 적습니다.
- 학생 답안을 외부 API로 보내기 전에 이름·학번 등 식별 정보를 제거하는 단계를 둡니다.
- Gemini 무료 등급에는 실제 학생 답안을 보내지 않습니다 (5절).

---

## 8. 평가 계획

- **데이터:** 사용자가 직접 출제한 CS 전공 서술형 문항 3~5개, 문항당 답안 10~20개 (총 50~100건). 답안 작성은 LLM을 보조로 쓸 수 있으나, 정답 라벨은 반드시 사용자가 직접 매깁니다.
  - 경계 사례(부분 언급, 모호한 표현)를 의도적으로 포함해 `human` 경로와 임계값 보정을 검증합니다.
- **비교:** LLM 단독(GeminiJudge) vs 하이브리드(JevJudge + 에스컬레이션)
- **지표:** 사용자 라벨과의 일치도, 자동 처리율(임계값별 곡선), 건당 비용·지연, 확신도 구간별 실제 정확도(보정)
- **후속 과제로 넘긴 것:** 손글씨 OCR, 임계값 자동 보정, 실제 교수·조교 사용성 평가

---

## 9. 일정

| 주차 | 목표 | 상태 |
|---|---|---|
| 1주 | 판단 엔진을 노트북으로 먼저 검증 (기준 → 질문 변환, Jev 호출, 확신도 분기, Gemini 에스컬레이션). 평가용 문항 출제 시작 | 판단 엔진 완료 (2026-11-03). 평가용 문항 미착수 |
| 2주 | FastAPI 라우터, DB 스키마, 파일 업로드·파싱, 기준 초안 생성 | 진행 중: DB 스키마 완료 |
| 3주 | 검토 UI (항목별 모아보기, 근거 하이라이트, 수용/수정, 점수 확정, CSV 내보내기) | |
| 4주 | 평가셋 완성, 비교 실험, 유사도 플래그, 인증, 배포 | |
| 5주 | 보고서·발표 | |

일정이 밀리면 줄이는 순서: 유사도 플래그 → 기준 초안 자동 생성 → 배포(로컬 데모로 대체). 판단 엔진과 검토 UI는 반드시 지킵니다.
