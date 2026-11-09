"""Accounts and logins: argon2id password hashes, server-side sessions in an httpOnly cookie, and ownership checks.

Every course belongs to one user. Routers load courses, assignments, submissions and grades through the `own_*`
helpers, which answer 404 for someone else's data (not 403, so ids do not reveal what exists).
"""

import hashlib
import os
import secrets
from datetime import UTC, datetime, timedelta

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError
from fastapi import Cookie, Depends, HTTPException, Response, status
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import get_db
from app.models import Assignment, AuthSession, Course, Grade, Submission, User

COOKIE = "fastabc_session"
SESSION_DAYS = 14
# off for http://localhost; set COOKIE_SECURE=1 behind https
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "") == "1"

_hasher = PasswordHasher()  # argon2id with the library's recommended parameters
_DUMMY_HASH = _hasher.hash("timing equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def check_password(user: User | None, password: str) -> bool:
    """Verifies against a dummy hash when there is no such user, so timing does not tell which emails exist."""
    try:
        return _hasher.verify(user.password_hash if user else _DUMMY_HASH, password) and user is not None
    except (VerificationError, InvalidHashError):
        return False


def _digest(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()


def start_session(db: Session, user: User, response: Response) -> None:
    token = secrets.token_urlsafe(32)
    db.add(AuthSession(token_hash=_digest(token), user_id=user.id, expires_at=datetime.now(UTC) + timedelta(days=SESSION_DAYS)))
    db.commit()
    response.set_cookie(
        COOKIE,
        token,
        max_age=SESSION_DAYS * 86400,
        httponly=True,
        samesite="lax",  # the web app and the API share a site (localhost), so cross-site requests carry no cookie
        secure=COOKIE_SECURE,
    )


def end_session(db: Session, token: str | None, response: Response) -> None:
    if token:
        session = db.get(AuthSession, _digest(token))
        if session is not None:
            db.delete(session)
            db.commit()
    response.delete_cookie(COOKIE, httponly=True, samesite="lax", secure=COOKIE_SECURE)


def current_user(
    db: Session = Depends(get_db), token: str | None = Cookie(default=None, alias=COOKIE)
) -> User:
    session = db.get(AuthSession, _digest(token)) if token else None
    if session is None or session.expires_at <= datetime.now(UTC):
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, "login required")
    return session.user


def _not_found(what: str) -> HTTPException:
    return HTTPException(status.HTTP_404_NOT_FOUND, f"{what} not found")


def own_course(db: Session, user: User, course_id: int) -> Course:
    course = db.get(Course, course_id)
    if course is None or course.owner_id != user.id:
        raise _not_found("course")
    return course


def own_assignment(db: Session, user: User, assignment_id: int) -> Assignment:
    assignment = db.get(Assignment, assignment_id)
    if assignment is None or assignment.course.owner_id != user.id:
        raise _not_found("assignment")
    return assignment


def own_submission(db: Session, user: User, submission_id: int) -> Submission:
    submission = db.get(Submission, submission_id)
    if submission is None or submission.assignment.course.owner_id != user.id:
        raise _not_found("submission")
    return submission


def own_grade(db: Session, user: User, grade_id: int) -> Grade:
    owner = db.scalar(
        select(Course.owner_id)
        .join(Assignment, Assignment.course_id == Course.id)
        .join(Submission, Submission.assignment_id == Assignment.id)
        .join(Grade, Grade.submission_id == Submission.id)
        .where(Grade.id == grade_id)
    )
    if owner != user.id:
        raise _not_found("grade")
    return db.get(Grade, grade_id)
