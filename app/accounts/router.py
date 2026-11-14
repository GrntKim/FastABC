from app.accounts.models import *
from datetime import datetime, UTC, timedelta

from fastapi import Cookie, Depends, Request, APIRouter, Form
from fastapi.responses import RedirectResponse
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.security import *
from app.core.config import COOKIE, COOKIE_SECURE, SESSION_DAYS
from app.core.db import get_db
from app.core.templates import templates
from app.accounts.deps import page_user
from typing import Annotated

router = APIRouter()

def _open_session(db: Session, user: User) -> str:
    token = new_token()
    db.add(AuthSession(token_hash=token_hash(token), user_id=user.id,
                       expires_at=datetime.now(UTC) + timedelta(days=SESSION_DAYS)))
    db.commit()
    return token


@router.get("/login")
def login_page(request: Request):
    return templates.TemplateResponse(request, "login.html", {"error": None})


@router.post("/login")
def login(request: Request,
          email: Annotated[str, Form()], password: Annotated[str, Form()],
          db: Session = Depends(get_db)):
    email = email.strip().lower()
    user = db.scalar(select(User).where(User.email == email))
    if not check_password(user.password_hash if user else None, password):
        return templates.TemplateResponse(
            request, "login.html", {"error": "이메일 또는 비밀번호가 맞지 않습니다", "email": email},
            status_code=401)
    resp = RedirectResponse("/", status_code=303)
    resp.set_cookie(COOKIE, _open_session(db, user), max_age=SESSION_DAYS * 86400,
                    httponly=True, samesite="lax", secure=COOKIE_SECURE)
    return resp


@router.post("/logout")
def logout(db: Session = Depends(get_db),
           token: str | None = Cookie(default=None, alias=COOKIE)):
    if token:
        session = db.get(AuthSession, token_hash(token))
        if session:
            db.delete(session)
            db.commit()
    
    resp = RedirectResponse("/login", status_code=303)
    resp.delete_cookie(COOKIE, httponly=True, samesite="lax", secure=COOKIE_SECURE)
    
    return resp