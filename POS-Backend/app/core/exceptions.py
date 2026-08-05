"""Domain exceptions and HTTP error response helpers."""
import logging
from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException
from starlette.status import HTTP_500_INTERNAL_SERVER_ERROR

logger = logging.getLogger("pos_api.errors")


def _json_safe(value: Any) -> Any:
    if isinstance(value, BaseException):
        return str(value)
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    if isinstance(value, dict):
        return {str(key): _json_safe(item) for key, item in value.items()}
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, tuple):
        return [_json_safe(item) for item in value]
    return value


class AppError(Exception):
    """Base application error."""

    status_code = 400
    detail = "Bad request"
    code = "BAD_REQUEST"

    def __init__(
        self,
        detail: str | None = None,
        code: str | None = None,
        details: dict[str, Any] | list[Any] | None = None,
    ):
        if detail:
            self.detail = detail
        if code:
            self.code = code
        self.details = details
        super().__init__(self.detail)


class NotFoundError(AppError):
    status_code = 404
    detail = "Resource not found"
    code = "NOT_FOUND"


class ConflictError(AppError):
    status_code = 409
    detail = "Resource conflict"
    code = "CONFLICT"


class ForbiddenError(AppError):
    status_code = 403
    detail = "Not permitted"
    code = "FORBIDDEN"


class UnauthorizedError(AppError):
    status_code = 401
    detail = "Authentication required"
    code = "UNAUTHORIZED"


class ValidationError(AppError):
    status_code = 422
    detail = "Validation failed"
    code = "VALIDATION_ERROR"


class BusinessRuleError(AppError):
    status_code = 400
    detail = "Business rule violation"
    code = "BUSINESS_RULE_VIOLATION"


def error_content(
    *,
    message: str,
    error: str,
    code: str | None = None,
    details: dict[str, Any] | list[Any] | None = None,
) -> dict[str, Any]:
    return {
        "success": False,
        "message": message,
        "error": {
            "code": code or error,
            "message": message,
            "type": error,
        },
        "details": details or {},
    }


async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_content(
            message=exc.detail,
            error=exc.__class__.__name__,
            code=exc.code,
            details=exc.details,
        ),
    )


async def validation_error_handler(
    request: Request,
    exc: RequestValidationError,
) -> JSONResponse:
    return JSONResponse(
        status_code=422,
        content=error_content(
            message="Validation failed",
            error="RequestValidationError",
            code="VALIDATION_ERROR",
            details=_json_safe(exc.errors()),
        ),
    )


async def http_error_handler(
    request: Request,
    exc: StarletteHTTPException,
) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content=error_content(
            message=str(exc.detail),
            error="HTTPException",
            code="HTTP_ERROR",
        ),
    )


async def unhandled_error_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception while processing %s", request.url.path)
    return JSONResponse(
        status_code=HTTP_500_INTERNAL_SERVER_ERROR,
        content=error_content(
            message="Internal server error",
            error="InternalServerError",
            code="INTERNAL_SERVER_ERROR",
        ),
    )
