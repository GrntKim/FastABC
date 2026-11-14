import hashlib
import secrets

from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError


_hasher = PasswordHasher()
_DUMMY_HASH = _hasher.hash("timing equaliser")


def hash_password(password: str) -> str:
    return _hasher.hash(password)


def check_password(stored_hash: str | None, password: str) -> bool:
    try:
        return _hasher.verify(stored_hash if stored_hash else _DUMMY_HASH, password) and stored_hash is not None
    except (VerificationError, InvalidHashError):
        return False


def new_token() -> str:
    return secrets.token_urlsafe(32)


def token_hash(token: str) -> str:
    return hashlib.sha256(token.encode()).hexdigest()