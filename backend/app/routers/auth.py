"""Sign up, log in and out, and who is logged in. Anyone can sign up; there is no email verification."""

from fastapi import APIRouter, Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.auth import COOKIE, check_password, current_user, end_session, hash_password, start_session
from app.db import get_db
from app.models import User
from app.schemas import LoginIn, SignupIn, UserOut

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", status_code=status.HTTP_201_CREATED)
def signup(body: SignupIn, response: Response, db: Session = Depends(get_db)) -> UserOut:
    """Creates the account and logs it in."""
    if db.scalar(select(User.id).where(User.email == body.email)) is not None:
        raise HTTPException(status.HTTP_409_CONFLICT, "이미 가입한 이메일입니다")
    user = User(email=body.email, name=body.name, password_hash=hash_password(body.password))
    db.add(user)
    db.flush()
    start_session(db, user, response)
    return UserOut.model_validate(user)


@router.post("/login")
def login(body: LoginIn, response: Response, db: Session = Depends(get_db)) -> UserOut:
    user = db.scalar(select(User).where(User.email == body.email.strip().lower()))
    if not check_password(user, body.password):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "이메일 또는 비밀번호가 맞지 않습니다")
    start_session(db, user, response)
    return UserOut.model_validate(user)


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(response: Response, db: Session = Depends(get_db), token: str | None = Cookie(default=None, alias=COOKIE)) -> None:
    end_session(db, token, response)


@router.get("/me")
def me(user: User = Depends(current_user)) -> UserOut:
    return UserOut.model_validate(user)
