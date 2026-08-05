"""Per-request profiling counters used by lightweight response headers."""
from __future__ import annotations

import time
from contextvars import ContextVar
from dataclasses import dataclass, field


@dataclass
class RequestProfile:
    db_queries: int = 0
    db_time_ms: float = 0.0
    db_commit_ms: float = 0.0
    db_rollback_ms: float = 0.0
    db_slowest_ms: float = 0.0
    db_slowest_statement: str = ""
    _starts: list[float] = field(default_factory=list)


_profile_ctx: ContextVar[RequestProfile | None] = ContextVar(
    "request_profile",
    default=None,
)


def start_profile() -> tuple[RequestProfile, object]:
    profile = RequestProfile()
    token = _profile_ctx.set(profile)
    return profile, token


def current_profile() -> RequestProfile | None:
    return _profile_ctx.get()


def reset_profile(token: object) -> None:
    _profile_ctx.reset(token)


def begin_query() -> None:
    profile = current_profile()
    if profile is not None:
        profile._starts.append(time.perf_counter())


def end_query(statement: str) -> None:
    profile = current_profile()
    if profile is None or not profile._starts:
        return
    elapsed_ms = (time.perf_counter() - profile._starts.pop()) * 1000
    profile.db_queries += 1
    profile.db_time_ms += elapsed_ms
    if elapsed_ms > profile.db_slowest_ms:
        profile.db_slowest_ms = elapsed_ms
        profile.db_slowest_statement = " ".join(statement.split())[:240]
