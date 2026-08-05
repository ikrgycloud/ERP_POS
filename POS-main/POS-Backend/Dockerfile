FROM python:3.12-slim AS builder

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    UPLOAD_DIR=/app/uploads

WORKDIR /app

COPY --from=erp_shared_domain . /tmp/shared_domain
COPY POS-Backend/requirements.txt .
RUN pip wheel --no-cache-dir --wheel-dir /wheels /tmp/shared_domain -r requirements.txt


FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY --from=builder /wheels /wheels
RUN pip install --no-cache --find-links=/wheels /wheels/* \
    && rm -rf /wheels

COPY POS-Backend/app ./app
COPY POS-Backend/alembic ./alembic
COPY POS-Backend/alembic.ini ./alembic.ini
COPY POS-Backend/scripts ./scripts


RUN mkdir -p /app/logs /app/uploads \
    && useradd -m appuser \
    && chown -R appuser:appuser /app

USER appuser

VOLUME ["/app/uploads"]

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f\"http://127.0.0.1:{os.getenv('PORT', '8000')}/health\", timeout=3).read()"

CMD ["python", "-m", "app.server"]
