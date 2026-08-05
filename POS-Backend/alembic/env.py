"""Alembic async environment."""
import asyncio
from logging.config import fileConfig

from sqlalchemy import pool
from sqlalchemy import inspect, text
from sqlalchemy.engine import Connection
from sqlalchemy.ext.asyncio import async_engine_from_config

from alembic import context
from alembic.script import ScriptDirectory

from app.core.config import settings
from app.db.session import Base
import app.models  # noqa: F401  (populate metadata)

config = context.config
config.set_main_option("sqlalchemy.url", settings.DATABASE_URL.replace("%", "%%"))

if config.config_file_name is not None:
    fileConfig(config.config_file_name)

target_metadata = Base.metadata


def do_run_migrations(connection: Connection) -> None:
    existing_tables = set(inspect(connection).get_table_names())
    application_tables = existing_tables - {"alembic_version", "schema_migrations"}
    if not application_tables:
        # A new deployment needs the current schema, not a replay of historical
        # revisions whose baseline imports current ORM metadata. Replaying those
        # revisions would attempt to create the same tables twice.
        Base.metadata.create_all(bind=connection, checkfirst=True)
        head = ScriptDirectory.from_config(config).get_current_head()
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS alembic_version "
                "(version_num VARCHAR(128) NOT NULL PRIMARY KEY)"
            )
        )
        connection.execute(text("DELETE FROM alembic_version"))
        connection.execute(
            text("INSERT INTO alembic_version (version_num) VALUES (:head)"),
            {"head": head},
        )
        connection.commit()
        print(f"Initialized clean database at Alembic revision {head}")
        return
    context.configure(connection=connection, target_metadata=target_metadata, compare_type=True)
    with context.begin_transaction():
        context.run_migrations()


async def run_async_migrations() -> None:
    connectable = async_engine_from_config(
        config.get_section(config.config_ini_section, {}),
        prefix="sqlalchemy.",
        poolclass=pool.NullPool,
    )
    async with connectable.connect() as connection:
        await connection.run_sync(do_run_migrations)
        # The async connection is opened without an explicit transaction
        # context. Commit the revision update so Alembic's version marker is
        # durable after a successful migration run.
        await connection.commit()
    await connectable.dispose()


def run_migrations_offline() -> None:
    context.configure(
        url=settings.DATABASE_URL,
        target_metadata=target_metadata,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    asyncio.run(run_async_migrations())


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
