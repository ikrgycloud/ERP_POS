"""Reusable pagination dependency."""
from dataclasses import dataclass

from fastapi import Query


@dataclass(frozen=True)
class PaginationParams:
    skip: int = 0
    limit: int = 50
    cursor: int | None = None


def pagination_params(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=50, ge=1, le=100),
    cursor: int | None = Query(default=None, ge=1),
) -> PaginationParams:
    return PaginationParams(skip=skip, limit=limit, cursor=cursor)
