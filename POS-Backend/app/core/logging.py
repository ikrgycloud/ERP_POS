"""Application logging setup and request correlation helpers."""
import logging
import sys
from contextvars import ContextVar
from logging.handlers import RotatingFileHandler
from pathlib import Path

from app.core.config import settings

request_id_ctx: ContextVar[str] = ContextVar("request_id", default="-")


class RequestIdFilter(logging.Filter):
    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_ctx.get()
        return True


def configure_logging() -> None:
    """Configure console and rotating-file logging once per process."""
    level = getattr(logging, settings.LOG_LEVEL)
    formatter = logging.Formatter(
        "%(asctime)s %(levelname)s [%(name)s] [request_id=%(request_id)s] %(message)s"
    )
    request_filter = RequestIdFilter()

    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(formatter)
    console.addFilter(request_filter)
    root.addHandler(console)

    if settings.LOG_FILE:
        log_path = Path(settings.LOG_FILE)
        log_path.parent.mkdir(parents=True, exist_ok=True)
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=10 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
        )
        file_handler.setFormatter(formatter)
        file_handler.addFilter(request_filter)
        root.addHandler(file_handler)

    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if settings.LOG_SQL or settings.DB_ECHO else logging.WARNING
    )
