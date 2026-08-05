"""HTTP middleware for observability and defensive defaults."""
import logging
import time
from collections import Counter, defaultdict, deque
from uuid import uuid4

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware, RequestResponseEndpoint
from starlette.responses import JSONResponse

from app.core.config import settings
from app.core.logging import request_id_ctx
from app.core.profiling import reset_profile, start_profile

logger = logging.getLogger("pos_api.request")
REQUEST_TOTALS: Counter[str] = Counter()
REQUEST_ERROR_TOTALS: Counter[str] = Counter()
REQUEST_LATENCY_MS: Counter[str] = Counter()


class RequestContextMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        request_id = request.headers.get("x-request-id") or str(uuid4())
        token = request_id_ctx.set(request_id)
        profile, profile_token = start_profile()
        request.state.request_id = request_id
        start = time.perf_counter()
        try:
            response = await call_next(request)
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            route_key = f"{request.method}:{request.url.path}:{response.status_code}"
            REQUEST_TOTALS[route_key] += 1
            REQUEST_LATENCY_MS[route_key] += duration_ms
            if response.status_code >= 500:
                REQUEST_ERROR_TOTALS[route_key] += 1
            response.headers["x-request-id"] = request_id
            response.headers["x-process-time-ms"] = str(duration_ms)
            response.headers["x-db-query-count"] = str(profile.db_queries)
            response.headers["x-db-time-ms"] = f"{profile.db_time_ms:.2f}"
            response.headers["x-db-commit-ms"] = f"{profile.db_commit_ms:.2f}"
            response.headers["x-db-rollback-ms"] = f"{profile.db_rollback_ms:.2f}"
            response.headers["x-db-slowest-ms"] = f"{profile.db_slowest_ms:.2f}"
            if settings.DEBUG and profile.db_slowest_statement:
                response.headers["x-db-slowest-stmt"] = profile.db_slowest_statement
            logger.info(
                "%s %s -> %s %.2fms",
                request.method,
                request.url.path,
                response.status_code,
                duration_ms,
            )
            return response
        except Exception:
            duration_ms = round((time.perf_counter() - start) * 1000, 2)
            route_key = f"{request.method}:{request.url.path}:500"
            REQUEST_TOTALS[route_key] += 1
            REQUEST_ERROR_TOTALS[route_key] += 1
            REQUEST_LATENCY_MS[route_key] += duration_ms
            logger.exception(
                "%s %s -> 500 %.2fms",
                request.method,
                request.url.path,
                duration_ms,
            )
            raise
        finally:
            reset_profile(profile_token)
            request_id_ctx.reset(token)


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        response = await call_next(request)
        response.headers.setdefault("x-content-type-options", "nosniff")
        response.headers.setdefault("x-frame-options", "DENY")
        response.headers.setdefault("referrer-policy", "no-referrer")
        response.headers.setdefault(
            "permissions-policy",
            "camera=(), microphone=(), geolocation=()",
        )
        if settings.is_production:
            response.headers.setdefault(
                "strict-transport-security",
                "max-age=31536000; includeSubDomains",
            )
        return response


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Simple per-process IP rate limiter.

    For multi-instance production deployments, replace this with Redis or an
    API gateway limiter. This still protects local/dev and single-node setups.
    """

    def __init__(self, app):
        super().__init__(app)
        self._hits: dict[str, deque[float]] = defaultdict(deque)

    async def dispatch(
        self,
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        if not settings.RATE_LIMIT_ENABLED:
            return await call_next(request)

        now = time.monotonic()
        window_start = now - settings.RATE_LIMIT_WINDOW_SECONDS
        client = request.client.host if request.client else "unknown"
        hits = self._hits[client]
        while hits and hits[0] < window_start:
            hits.popleft()
        if len(hits) >= settings.RATE_LIMIT_REQUESTS:
            return JSONResponse(
                status_code=429,
                content={
                    "success": False,
                    "message": "Too many requests",
                    "error": {
                        "code": "RATE_LIMITED",
                        "message": "Too many requests",
                        "type": "RateLimitError",
                    },
                    "details": {},
                },
            )
        hits.append(now)
        return await call_next(request)
