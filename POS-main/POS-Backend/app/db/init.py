"""Database startup initialization.

This module owns idempotent schema creation for local development and first
bootstraps. Alembic remains the source of truth for future schema migrations.
"""
import asyncio
import logging
import re

from sqlalchemy import inspect, text
from sqlalchemy.engine import make_url
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncEngine, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import settings
from app.db.session import Base
import app.models  # noqa: F401  (populate Base.metadata before create_all)

logger = logging.getLogger("pos_api.db")


class DatabaseInitializer:
    """Initialize database infrastructure during application startup."""

    def __init__(self, engine: AsyncEngine, database_url: str) -> None:
        self._engine = engine
        self._database_url = database_url

    async def initialize(self) -> None:
        """Create the database when supported, then create missing tables."""
        logger.info(
            "Inventory startup check: Legacy compatibility mode: DISABLED | "
            "Inventory bootstrap: DISABLED | Synthetic ledger generation: DISABLED | "
            "Opening balance generation: DISABLED"
        )
        self._verify_metadata_populated()
        for attempt in range(1, settings.DB_INIT_RETRIES + 1):
            try:
                if settings.AUTO_CREATE_DATABASE:
                    await self._create_database_if_supported()
                if settings.AUTO_CREATE_TABLES:
                    await self._create_missing_tables()
                await self._verify_database_objects()
                logger.info("Database initialization completed")
                return
            except SQLAlchemyError:
                if attempt == settings.DB_INIT_RETRIES:
                    logger.exception("Database initialization failed")
                    raise
                logger.warning(
                    "Database initialization attempt %s/%s failed; retrying",
                    attempt,
                    settings.DB_INIT_RETRIES,
                )
                await asyncio.sleep(settings.DB_INIT_RETRY_SECONDS)

    async def shutdown(self) -> None:
        """Release database connections on application shutdown."""
        await self._engine.dispose()

    async def _create_database_if_supported(self) -> None:
        """Create a missing PostgreSQL database when the login can do so.

        SQLAlchemy engines are lazy, so this can run before the main engine has
        opened a connection to the target database. For non-PostgreSQL backends,
        table creation is enough. For PostgreSQL, this is best effort because
        managed databases often deny CREATE DATABASE.
        """
        url = make_url(self._database_url)
        if url.get_backend_name() != "postgresql" or not url.database:
            logger.info("Automatic database creation skipped for backend %s", url.get_backend_name())
            return

        admin_url = url.set(database="postgres")
        admin_engine = create_async_engine(
            admin_url,
            echo=settings.DB_ECHO,
            isolation_level="AUTOCOMMIT",
            poolclass=NullPool,
        )

        try:
            async with admin_engine.connect() as connection:
                exists = await connection.scalar(
                    text("SELECT 1 FROM pg_database WHERE datname = :database_name"),
                    {"database_name": url.database},
                )
                if exists:
                    logger.info("Existing database detected: %s", url.database)
                    return

                preparer = admin_engine.sync_engine.dialect.identifier_preparer
                database_name = preparer.quote(url.database)
                await connection.execute(text(f"CREATE DATABASE {database_name}"))
                logger.info("Created database %s", url.database)
        except SQLAlchemyError as exc:
            logger.warning(
                "Skipping automatic database creation for %s: %s",
                url.database,
                exc.__class__.__name__,
            )
        finally:
            await admin_engine.dispose()

    async def _create_missing_tables(self) -> None:
        async with self._engine.begin() as connection:
            logger.info("Database connected")
            if self._engine.dialect.name == "postgresql":
                await connection.execute(
                    text("SELECT pg_advisory_lock(hashtext(:key))"),
                    {"key": "pos_api_schema_init"},
                )
                try:
                    existing_tables = await connection.run_sync(
                        lambda sync_conn: set(inspect(sync_conn).get_table_names())
                    )
                    logger.info("Existing tables detected: %s", len(existing_tables))
                    await connection.run_sync(
                        Base.metadata.create_all,
                        checkfirst=True,
                    )
                    await self._apply_erp_compatibility(connection)
                finally:
                    await connection.execute(
                        text("SELECT pg_advisory_unlock(hashtext(:key))"),
                        {"key": "pos_api_schema_init"},
                    )
            else:
                existing_tables = await connection.run_sync(
                    lambda sync_conn: set(inspect(sync_conn).get_table_names())
                )
                logger.info("Existing tables detected: %s", len(existing_tables))
                await connection.run_sync(Base.metadata.create_all, checkfirst=True)

        logger.info("Tables created or verified with checkfirst=True")

    async def _apply_erp_compatibility(self, connection) -> None:
        """Add POS-required columns when booting against the ERP database.

        The ERP backend owns several shared tables already. SQLAlchemy
        `create_all(checkfirst=True)` creates missing tables, but it never
        alters existing tables. These additions are intentionally nullable or
        defaulted so they are safe for existing ERP rows and idempotent across
        restarts.
        """
        if self._engine.dialect.name != "postgresql":
            return

        statements = [
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS barcode VARCHAR(80)
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS damaged_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS returned_damaged_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS expired_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS quarantine_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS reserved_qty NUMERIC(12, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS qty_returned NUMERIC(12, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE products
            ADD COLUMN IF NOT EXISTS stock_cached NUMERIC(14, 3) NOT NULL DEFAULT 0
            """,
            """
            ALTER TABLE orders
            ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES staff(id)
            """,
            """
            ALTER TABLE notification_outbox
            ADD COLUMN IF NOT EXISTS public_url VARCHAR(500)
            """,
            """
            ALTER TABLE notification_outbox
                ADD COLUMN IF NOT EXISTS parent_outbox_id INTEGER NULL REFERENCES notification_outbox(id) ON DELETE SET NULL,
                ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(180),
                ADD COLUMN IF NOT EXISTS event_type VARCHAR(80),
                ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(80),
                ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(80),
                ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'::jsonb,
                ADD COLUMN IF NOT EXISTS max_attempts INTEGER DEFAULT 6,
                ADD COLUMN IF NOT EXISTS provider_response JSONB NULL,
                ADD COLUMN IF NOT EXISTS dead_lettered_at TIMESTAMPTZ NULL,
                ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ NULL,
                ADD COLUMN IF NOT EXISTS lock_owner VARCHAR(120) NULL,
                ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ NULL
            """,
            """
            UPDATE notification_outbox
            SET
                idempotency_key = COALESCE(NULLIF(idempotency_key, ''), 'legacy-pos-notification-' || id::text),
                event_type = COALESCE(NULLIF(event_type, ''), 'invoice_notification'),
                aggregate_type = COALESCE(NULLIF(aggregate_type, ''), 'invoice'),
                aggregate_id = COALESCE(NULLIF(aggregate_id, ''), COALESCE(invoice_id::text, id::text)),
                payload = COALESCE(payload, '{}'::jsonb),
                max_attempts = GREATEST(COALESCE(max_attempts, 6), 6)
            """,
            """
            ALTER TABLE notification_outbox
                ALTER COLUMN idempotency_key SET NOT NULL,
                ALTER COLUMN event_type SET NOT NULL,
                ALTER COLUMN aggregate_type SET NOT NULL,
                ALTER COLUMN aggregate_id SET NOT NULL,
                ALTER COLUMN payload SET NOT NULL,
                ALTER COLUMN max_attempts SET NOT NULL
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_notification_outbox_idempotency_key
            ON notification_outbox (idempotency_key)
            """,
            """
            ALTER TABLE notification_history
                ADD COLUMN IF NOT EXISTS event_type VARCHAR(80),
                ADD COLUMN IF NOT EXISTS aggregate_type VARCHAR(80),
                ADD COLUMN IF NOT EXISTS aggregate_id VARCHAR(80),
                ADD COLUMN IF NOT EXISTS channel_summary JSONB DEFAULT '{}'::jsonb
            """,
            """
            UPDATE notification_history
            SET
                event_type = COALESCE(NULLIF(event_type, ''), 'invoice_notification'),
                aggregate_type = COALESCE(NULLIF(aggregate_type, ''), 'invoice'),
                aggregate_id = COALESCE(NULLIF(aggregate_id, ''), COALESCE(invoice_id::text, id::text)),
                channel_summary = COALESCE(channel_summary, '{}'::jsonb)
            """,
            """
            ALTER TABLE notification_history
                ALTER COLUMN event_type SET NOT NULL,
                ALTER COLUMN aggregate_type SET NOT NULL,
                ALTER COLUMN aggregate_id SET NOT NULL,
                ALTER COLUMN channel_summary SET NOT NULL
            """,
            """
            ALTER TABLE invoices
            ADD COLUMN IF NOT EXISTS staff_id INTEGER REFERENCES staff(id)
            """,
            """
            ALTER TABLE invoices
            ADD COLUMN IF NOT EXISTS payment_method VARCHAR(30)
            """,
            """
            ALTER TABLE returns
            ADD COLUMN IF NOT EXISTS refund_status VARCHAR(30) NOT NULL DEFAULT 'pending'
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_products_business_barcode
            ON products (business_profile_id, barcode)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_products_name
            ON products (name)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_orders_staff_id
            ON orders (staff_id)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_invoices_staff_id
            ON invoices (staff_id)
            """,
            """
            CREATE TABLE IF NOT EXISTS inventory_ledger (
                id SERIAL PRIMARY KEY,
                product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE,
                business_profile_id INTEGER NULL REFERENCES business_profiles(id),
                outlet_id INTEGER NULL REFERENCES outlets(id),
                type VARCHAR(30) NOT NULL,
                quantity NUMERIC(12, 3) NOT NULL,
                idempotency_key TEXT NULL,
                user_id VARCHAR(80) NULL,
                source VARCHAR(40) NULL,
                reference_type VARCHAR(40) NULL,
                reference_id VARCHAR(80) NULL,
                created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
                updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
            )
            """,
            """
            ALTER TABLE inventory_ledger
                ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
                ADD COLUMN IF NOT EXISTS user_id VARCHAR(80),
                ADD COLUMN IF NOT EXISTS source VARCHAR(40),
                ADD COLUMN IF NOT EXISTS old_stock NUMERIC(14, 3),
                ADD COLUMN IF NOT EXISTS new_stock NUMERIC(14, 3),
                ADD COLUMN IF NOT EXISTS reason VARCHAR(80)
            """,
            """
            DO $$
            BEGIN
                IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_ledger_type') THEN
                    ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'EXPIRED';
                    ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'QUARANTINE';
                END IF;
            END $$
            """,
            """
            ALTER TABLE inventory_ledger
                ALTER COLUMN reference_id TYPE VARCHAR(80)
                USING reference_id::text
            """,
            """
            CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_idempotency_key
            ON inventory_ledger (idempotency_key)
            WHERE idempotency_key IS NOT NULL
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_inventory_ledger_user_id
            ON inventory_ledger (user_id)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_inventory_ledger_source
            ON inventory_ledger (source)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reason
            ON inventory_ledger (reason)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_inventory_ledger_product_id
            ON inventory_ledger (product_id)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_profile_id
            ON inventory_ledger (business_profile_id)
            """,
            """
            CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reference
            ON inventory_ledger (reference_type, reference_id)
            """,
        ]

        for statement in statements:
            operation = " ".join(statement.strip().split())[:160]
            try:
                await connection.execute(text(statement))
            except SQLAlchemyError:
                logger.exception("ERP compatibility statement failed: %s", operation)
                raise
        logger.info("ERP compatibility columns verified")

    def _verify_metadata_populated(self) -> None:
        table_count = len(Base.metadata.tables)
        if table_count == 0:
            raise RuntimeError("SQLAlchemy metadata is empty; model imports failed")
        logger.info("SQLAlchemy metadata loaded with %s tables", table_count)

    async def _verify_database_objects(self) -> None:
        async with self._engine.connect() as connection:
            result = await connection.run_sync(self._inspect_database_objects)

        missing_tables = result["missing_tables"]
        missing_indexes = result["missing_indexes"]
        missing_foreign_keys = result["missing_foreign_keys"]

        if missing_tables or missing_foreign_keys:
            raise RuntimeError(
                "Database verification failed: "
                f"missing_tables={sorted(missing_tables)}, "
                f"missing_foreign_keys={sorted(missing_foreign_keys)}"
            )

        if missing_indexes:
            logger.warning(
                "Database verification found missing non-critical indexes: %s",
                sorted(missing_indexes),
            )
            logger.warning(
                "Create an Alembic migration with these operations:\n%s",
                "\n".join(result["missing_index_operations"]),
            )

        logger.info(
            "Database verification completed: %s tables, %s expected indexes, "
            "%s foreign keys",
            result["table_count"],
            result["index_count"],
            result["foreign_key_count"],
        )

    @staticmethod
    def _inspect_database_objects(sync_connection) -> dict:
        inspector = inspect(sync_connection)
        db_tables = set(inspector.get_table_names())
        expected_tables = set(Base.metadata.tables.keys())

        missing_tables = expected_tables - db_tables
        missing_indexes: set[str] = set()
        missing_index_operations: list[str] = []
        missing_foreign_keys: set[str] = set()
        index_count = 0
        foreign_key_count = 0
        use_postgres_catalog = sync_connection.dialect.name == "postgresql"
        postgres_indexes = DatabaseInitializer._load_postgres_index_specs(
            sync_connection
        )

        for table_name, table in Base.metadata.tables.items():
            if table_name not in db_tables:
                continue

            for index in table.indexes:
                index_count += 1
                expected_spec = DatabaseInitializer._index_spec(table_name, index)
                if not DatabaseInitializer._database_has_index(
                    inspector,
                    table_name,
                    expected_spec,
                    postgres_indexes,
                    use_postgres_catalog,
                ):
                    missing_indexes.add(f"{table_name}.{index.name}")
                    missing_index_operations.append(
                        DatabaseInitializer._migration_operation(table_name, index)
                    )

            db_fk_columns = {
                tuple(fk.get("constrained_columns") or [])
                for fk in inspector.get_foreign_keys(table_name)
            }
            for fk in table.foreign_key_constraints:
                foreign_key_count += 1
                columns = tuple(column.name for column in fk.columns)
                if columns not in db_fk_columns:
                    missing_foreign_keys.add(f"{table_name}.{','.join(columns)}")

        return {
            "table_count": len(expected_tables),
            "index_count": index_count,
            "foreign_key_count": foreign_key_count,
            "missing_tables": missing_tables,
            "missing_indexes": missing_indexes,
            "missing_index_operations": missing_index_operations,
            "missing_foreign_keys": missing_foreign_keys,
        }

    @staticmethod
    def _load_postgres_index_specs(sync_connection) -> dict[str, set[tuple]]:
        if sync_connection.dialect.name != "postgresql":
            return {}

        rows = sync_connection.execute(
            text(
                """
                SELECT tablename, indexname, indexdef
                FROM pg_indexes
                WHERE schemaname = current_schema()
                """
            )
        ).mappings()
        specs: dict[str, set[tuple]] = {}
        for row in rows:
            spec = DatabaseInitializer._pg_index_spec(
                row["indexname"],
                row["indexdef"],
            )
            if spec:
                specs.setdefault(row["tablename"], set()).add(spec)
        return specs

    @staticmethod
    def _database_has_index(
        inspector,
        table_name: str,
        expected_spec: tuple,
        postgres_indexes: dict[str, set[tuple]],
        use_postgres_catalog: bool,
    ) -> bool:
        if use_postgres_catalog:
            return expected_spec in postgres_indexes.get(table_name, set())

        # Non-PostgreSQL fallback for tests and local SQLite development.
        for db_index in inspector.get_indexes(table_name):
            db_columns = tuple(db_index.get("column_names") or [])
            db_unique = bool(db_index.get("unique"))
            if expected_spec == (db_unique, db_columns):
                return True
        return False

    @staticmethod
    def _index_spec(table_name: str, index) -> tuple:
        columns = tuple(column.name for column in index.columns)
        return bool(index.unique), columns

    @staticmethod
    def _pg_index_spec(index_name: str, indexdef: str) -> tuple | None:
        definition = " ".join(indexdef.lower().split())
        unique = definition.startswith("create unique index")
        match = re.search(r" using \w+ \((?P<columns>.+)\)$", definition)
        if not match:
            return None

        columns = []
        for raw_column in match.group("columns").split(","):
            column = raw_column.strip().strip('"')
            column = re.sub(r"\s+(asc|desc)(\s+nulls\s+(first|last))?$", "", column)
            columns.append(column)

        return unique, tuple(columns)

    @staticmethod
    def _migration_operation(table_name: str, index) -> str:
        columns = [column.name for column in index.columns]
        return (
            f"op.create_index({index.name!r}, {table_name!r}, "
            f"{columns!r}, unique={bool(index.unique)!r})"
        )
