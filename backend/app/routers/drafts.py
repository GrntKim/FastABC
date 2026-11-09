"""Plain-language rubric -> editable rubric items, for the assignment creation screen."""

import logging

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import ValidationError

from app.auth import current_user
from app.drafting import RubricDrafter, to_items
from app.grading import get_drafter
from app.schemas import RubricDraftIn, RubricDraftOut, RubricItemIn

logger = logging.getLogger(__name__)

# login only: each draft is a paid LLM call
router = APIRouter(tags=["drafts"], dependencies=[Depends(current_user)])


@router.post("/rubric-drafts")
def draft_rubric(body: RubricDraftIn, drafter: RubricDrafter = Depends(get_drafter)) -> RubricDraftOut:
    """One LLM call; nothing is stored. The grader reviews the items and saves them with the assignment."""
    try:
        draft = drafter.draft(body.problem, body.rubric_text)
    except Exception as e:
        logger.exception("rubric draft failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, "채점 기준을 변환하지 못했습니다. 다시 시도하세요.") from e

    items, warnings = to_items(draft)
    problems = []
    for i, item in enumerate(items):
        try:
            RubricItemIn.model_validate(item)
        except ValidationError as e:
            problems += [f"{i + 1}번 항목: {err['msg']}" for err in e.errors()]
    return RubricDraftOut(items=items, warnings=warnings, problems=problems)
