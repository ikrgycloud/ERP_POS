"""FastAPI application entry point."""
import sys
from pathlib import Path

from fastapi import FastAPI, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.httpsredirect import HTTPSRedirectMiddleware
from fastapi.staticfiles import StaticFiles
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.middleware.trustedhost import TrustedHostMiddleware

# Local monorepo runs start from POS-Backend, while Docker runs from /app.
# Add the repo root only when the sibling shared_domain package exists.
_repo_root = Path(__file__).resolve().parents[2]
if (_repo_root / "shared_domain").is_dir() and str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app.api.v1.router import api_router
from app.core.config import settings
from app.core.exceptions import (
    AppError,
    app_error_handler,
    http_error_handler,
    unhandled_error_handler,
    validation_error_handler,
)
from app.core.lifespan import create_lifespan
from app.core.logging import configure_logging
from app.core.middleware import (
    REQUEST_ERROR_TOTALS,
    REQUEST_LATENCY_MS,
    REQUEST_TOTALS,
    RateLimitMiddleware,
    RequestContextMiddleware,
    SecurityHeadersMiddleware,
)
from app.db.health import check_database
from app.db.session import engine

configure_logging()


def create_app(database_initializer=None) -> FastAPI:
    """Create and configure the FastAPI application."""
    app = FastAPI(
        title=settings.APP_NAME,
        version=settings.APP_VERSION,
        docs_url="/docs",
        redoc_url="/redoc",
        openapi_url="/openapi.json",
        lifespan=create_lifespan(database_initializer),
    )

    if settings.trusted_hosts != ["*"]:
        app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)
    if settings.ENABLE_HTTPS_REDIRECT:
        app.add_middleware(HTTPSRedirectMiddleware)

    app.add_middleware(SecurityHeadersMiddleware)
    app.add_middleware(RateLimitMiddleware)
    app.add_middleware(RequestContextMiddleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=None,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(RequestValidationError, validation_error_handler)
    app.add_exception_handler(StarletteHTTPException, http_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    @app.get("/health", tags=["meta"])
    async def health():
        database_ok = await check_database(engine)
        return {
            "status": "ok",
            "version": settings.APP_VERSION,
            "environment": settings.ENVIRONMENT.value,
            "database": "ok" if database_ok else "unavailable",
        }

    @app.get("/metrics", tags=["meta"])
    async def metrics():
        lines = [
            "# HELP pos_http_requests_total Total HTTP requests by method, path, and status.",
            "# TYPE pos_http_requests_total counter",
        ]
        for key, count in sorted(REQUEST_TOTALS.items()):
            method, path, status_code = key.split(":", 2)
            lines.append(
                f'pos_http_requests_total{{method="{method}",path="{path}",status="{status_code}"}} {count}'
            )
        lines.extend(
            [
                "# HELP pos_http_request_errors_total Total HTTP 5xx requests by method, path, and status.",
                "# TYPE pos_http_request_errors_total counter",
            ]
        )
        for key, count in sorted(REQUEST_ERROR_TOTALS.items()):
            method, path, status_code = key.split(":", 2)
            lines.append(
                f'pos_http_request_errors_total{{method="{method}",path="{path}",status="{status_code}"}} {count}'
            )
        lines.extend(
            [
                "# HELP pos_http_request_latency_ms_total Cumulative HTTP latency in milliseconds.",
                "# TYPE pos_http_request_latency_ms_total counter",
            ]
        )
        for key, total_ms in sorted(REQUEST_LATENCY_MS.items()):
            method, path, status_code = key.split(":", 2)
            lines.append(
                f'pos_http_request_latency_ms_total{{method="{method}",path="{path}",status="{status_code}"}} {total_ms:.2f}'
            )
        return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")

    @app.get(f"{settings.API_V1_PREFIX}/openapi.json", include_in_schema=False)
    async def api_v1_openapi():
        return app.openapi()

    app.include_router(api_router, prefix=settings.API_V1_PREFIX)
    app.mount(
        "/media",
        StaticFiles(directory=settings.UPLOAD_DIR, check_dir=False),
        name="media",
    )
    return app


app = create_app()
