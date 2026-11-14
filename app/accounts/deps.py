from app.accounts.models import User
from datetime import datetime, UTC

from fastapi import Cookie, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.accounts.models import AuthSession, User
from app.core.security import *
from app.core.config import COOKIE
from app.core.db import get_db
from app.core.errors import LoginRequired

def _user_from_cookie(db: Session, token: str | None) -> User | None:
    if not token:
        return None
    session = db.get(AuthSession, token_hash(token))
    if session is None or session.expires_at <= datetime.now(UTC):
        return None
    return session.user

def current_user(db: Session = Depends(get_db),
                 token: str | None = Cookie(default=None, alias=COOKIE)) -> User:
    user = _user_from_cookie(db, token)
    if user is None:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "login required")   # 옛 JSON 라우터용
    return user


def page_user(db: Session = Depends(get_db),
              token: str | None = Cookie(default=None, alias=COOKIE)) -> User:
    user = _user_from_cookie(db, token)
    if user is None:
        raise LoginRequired                                                    # 화면용: main이 /login으로 보냄
    return user