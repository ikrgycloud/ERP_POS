"""Password hashing and JWT token helpers."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from typing import Any, Optional
from uuid import uuid4

import bcrypt
import jwt

from app.core.config import settings

# bcrypt operates on the first 72 bytes of the password; longer inputs raise
# in bcrypt>=4. Truncate explicitly so behaviour is defined, not accidental.
_BCRYPT_MAX_BYTES = 72


def _to_bytes(plain: str) -> bytes:
    return plain.encode("utf-8")[:_BCRYPT_MAX_BYTES]


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(_to_bytes(plain), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    """Verify POS bcrypt hashes and ERP's established PBKDF2 hashes.

    ERP business administration creates POS staff in the shared database.  Its
    existing credential format is PBKDF2, so POS must support it during the
    shared-auth transition instead of rejecting valid staff accounts.
    """
    if not hashed:
        return False
    if hashed.startswith("pbkdf2_sha256$"):
        try:
            algorithm, iterations, salt, expected_digest = hashed.split("$", 3)
            digest = hashlib.pbkdf2_hmac(
                "sha256", plain.encode("utf-8"), salt.encode("utf-8"), int(iterations)
            ).hex()
            return algorithm == "pbkdf2_sha256" and hmac.compare_digest(digest, expected_digest)
        except (TypeError, ValueError):
            return False
    try:
        return bcrypt.checkpw(_to_bytes(plain), hashed.encode("utf-8"))
    except (ValueError, TypeError):
        return False


def _create_token(subject: str | int, claims: dict[str, Any], expires: timedelta) -> str:
    now = datetime.now(timezone.utc)
    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": now + expires,
        "jti": str(uuid4()),
        **claims,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_access_token(subject: str | int, claims: dict[str, Any]) -> str:
    return _create_token(
        subject,
        {**claims, "type": "access"},
        timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
    )


def create_refresh_token(subject: str | int) -> str:
    return _create_token(
        subject, {"type": "refresh"}, timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS)
    )


def decode_token(token: str) -> Optional[dict[str, Any]]:
    try:
        return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except jwt.PyJWTError:
        return None
