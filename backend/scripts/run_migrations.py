"""Run ERP SQL migrations with checksum tracking.

Usage:
    python scripts/run_migrations.py
"""

from __future__ import annotations

import hashlib
import os
import sys
from pathlib import Path

import psycopg2
from dotenv import load_dotenv
from sqlalchemy import create_engine

PROJECT_ROOT = Path(__file__).resolve().parents[1]
if str(PROJECT_ROOT) not in sys.path:
    sys.path.insert(0, str(PROJECT_ROOT))

# Match the application configuration: local commands should automatically use
# the backend .env file, while explicitly supplied environment variables retain
# precedence.
load_dotenv(PROJECT_ROOT / ".env")

def migration_files() -> list[Path]:
    migrations_dir = PROJECT_ROOT / "migrations"
    return sorted(
        path
        for path in migrations_dir.glob("*.sql")
        if not path.name.endswith("_rollback.sql")
    )


def checksum(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def ensure_schema_migrations(cursor) -> None:
    cursor.execute(
        """
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename TEXT PRIMARY KEY,
            checksum TEXT NOT NULL,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
        """
    )


def main() -> None:
    database_url = os.getenv("DATABASE_URL", "").strip()
    if not database_url:
        raise RuntimeError("DATABASE_URL is required to run ERP migrations")

    # ERP owns additional tables that are not part of the shared POS baseline
    # (uploaded files, reverse logistics, notification outbox, and payments).
    # Create only missing tables before applying incremental SQL upgrades.
    from app.database import Base
    import app.models  # noqa: F401

    bootstrap_engine = create_engine(database_url, pool_pre_ping=True)
    try:
        Base.metadata.create_all(bind=bootstrap_engine, checkfirst=True)
    finally:
        bootstrap_engine.dispose()
    files = migration_files()
    if not files:
        print("No migration files found")
        return

    with psycopg2.connect(database_url) as connection:
        connection.autocommit = False
        with connection.cursor() as cursor:
            ensure_schema_migrations(cursor)
            for path in files:
                sql = path.read_text(encoding="utf-8")
                digest = checksum(sql)
                cursor.execute(
                    "SELECT checksum FROM schema_migrations WHERE filename = %s",
                    (path.name,),
                )
                row = cursor.fetchone()
                if row:
                    if row[0] != digest:
                        raise RuntimeError(
                            f"Migration checksum changed after apply: {path.name}"
                        )
                    print(f"skip {path.name}")
                    continue
                print(f"apply {path.name}")
                cursor.execute(sql)
                cursor.execute(
                    """
                    INSERT INTO schema_migrations (filename, checksum)
                    VALUES (%s, %s)
                    """,
                    (path.name, digest),
                )
            connection.commit()
    print("ERP migrations complete")


if __name__ == "__main__":
    main()
