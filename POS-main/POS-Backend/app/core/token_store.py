"""Token revocation primitives.

The default store is intentionally small and in-process. Production deployments
with multiple workers should replace this module with Redis-backed storage
without changing API or dependency code.
"""
from datetime import datetime, timezone

_revoked_tokens: dict[str, datetime] = {}


def revoke_token(token_id: str | None, expires_at: datetime | None = None) -> None:
    if not token_id:
        return
    _revoked_tokens[token_id] = expires_at or datetime.now(timezone.utc)


def is_token_revoked(token_id: str | None) -> bool:
    if not token_id:
        return False
    expires_at = _revoked_tokens.get(token_id)
    if not expires_at:
        return False
    if expires_at < datetime.now(timezone.utc):
        _revoked_tokens.pop(token_id, None)
        return False
    return True


def clear_revoked_tokens() -> None:
    _revoked_tokens.clear()
