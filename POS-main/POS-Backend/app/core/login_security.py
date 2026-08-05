"""Account login throttling helpers."""
from datetime import datetime, timedelta, timezone

from app.core.config import settings

_attempts: dict[str, tuple[int, datetime | None]] = {}


def is_login_locked(identifier: str) -> bool:
    count, locked_until = _attempts.get(identifier, (0, None))
    if locked_until is None:
        return False
    if locked_until <= datetime.now(timezone.utc):
        _attempts.pop(identifier, None)
        return False
    return count >= settings.LOGIN_MAX_ATTEMPTS


def record_login_failure(identifier: str) -> None:
    count, locked_until = _attempts.get(identifier, (0, None))
    count += 1
    if count >= settings.LOGIN_MAX_ATTEMPTS:
        locked_until = datetime.now(timezone.utc) + timedelta(
            seconds=settings.LOGIN_LOCK_SECONDS
        )
    _attempts[identifier] = (count, locked_until)


def clear_login_failures(identifier: str) -> None:
    _attempts.pop(identifier, None)
