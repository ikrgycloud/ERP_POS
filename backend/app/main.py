import logging
import sys
import uuid
from collections import Counter, defaultdict, deque
from logging.handlers import RotatingFileHandler
from pathlib import Path
from threading import Lock
from time import monotonic, perf_counter

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles
from starlette.middleware.trustedhost import TrustedHostMiddleware
from sqlalchemy import text

# Local monorepo runs start from backend, while Docker runs from /app.
# Add the repo root only when the sibling shared_domain package exists.
_repo_root = Path(__file__).resolve().parents[2]
if (_repo_root / "shared_domain").is_dir() and str(_repo_root) not in sys.path:
    sys.path.insert(0, str(_repo_root))

from app import models
from app.api.gateway import api_gateway
from app.config import get_settings
from app.database import Base, engine
from app.notification_outbox import notification_worker


def configure_logging() -> logging.Logger:
    configured_settings = get_settings()
    log_path = Path(configured_settings.log_file)
    if not log_path.is_absolute():
        log_path = Path(__file__).resolve().parents[1] / log_path
    log_path.parent.mkdir(parents=True, exist_ok=True)

    formatter = logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s")
    console_handler = logging.StreamHandler()
    console_handler.setFormatter(formatter)

    handlers = [console_handler]
    try:
        file_handler = RotatingFileHandler(
            log_path,
            maxBytes=5 * 1024 * 1024,
            backupCount=5,
            encoding="utf-8",
            delay=True,
        )
        file_handler.setFormatter(formatter)
        handlers.append(file_handler)
    except OSError as exc:
        console_handler.handle(
            logging.LogRecord(
                name="erp-backend",
                level=logging.WARNING,
                pathname=__file__,
                lineno=0,
                msg=f"File logging disabled: {exc}",
                args=(),
                exc_info=None,
            )
        )

    level = getattr(logging, configured_settings.log_level)
    logging.basicConfig(level=level, handlers=handlers, force=True)
    logging.getLogger("uvicorn").setLevel(level)
    logging.getLogger("uvicorn.error").setLevel(level)
    logging.getLogger("uvicorn.access").setLevel(level)
    return logging.getLogger("erp-backend")


logger = configure_logging()
settings = get_settings()
STARTED_AT = monotonic()
REQUEST_TOTALS: Counter[str] = Counter()
REQUEST_ERROR_TOTALS: Counter[str] = Counter()
REQUEST_LATENCY_MS: Counter[str] = Counter()
RATE_LIMIT_BUCKETS: dict[tuple[str, str], deque[float]] = defaultdict(deque)
RATE_LIMIT_LOCK = Lock()

MARKET_CATEGORIES = [
    "Milk",
    "Water",
    "Chemicals",
    "Food Grains",
    "Groceries",
    "Beverages",
    "Packaging Materials",
    "Packets",
    "Bags",
    "Carton Boxes",
    "Raw Materials",
    "Loose Items",
    "Dairy Products",
    "Cleaning Supplies",
    "Hardware",
    "Electronics",
    "Stationery",
    "Agriculture",
    "Organic Products",
    "Pharmaceuticals",
]

app = FastAPI(
    title=settings.app_name,
    version="1.0.0",
    description="ERP API Gateway for products, orders, invoices, dashboard, business profile, and audit logs.",
)

if settings.trusted_hosts != ["*"]:
    app.add_middleware(TrustedHostMiddleware, allowed_hosts=settings.trusted_hosts)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_origin_regex=None,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

upload_dir = Path(settings.upload_dir)
if not upload_dir.is_absolute():
    upload_dir = Path(__file__).resolve().parents[1] / upload_dir
upload_dir.mkdir(parents=True, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=upload_dir), name="uploads")


def cors_response_headers(request: Request) -> dict[str, str]:
    origin = request.headers.get("origin")
    allow_any_origin = "*" in settings.cors_origins and not settings.is_production
    allowed_origin = (
        "*"
        if allow_any_origin
        else origin
        if origin in settings.cors_origins
        else None
    )
    headers = {
        "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
        "Access-Control-Allow-Headers": request.headers.get("access-control-request-headers", "*"),
        "Access-Control-Expose-Headers": "*",
    }
    if allowed_origin:
        headers["Access-Control-Allow-Origin"] = allowed_origin
    return headers


@app.on_event("startup")
def create_tables_on_startup() -> None:
    logger.info(
        "Inventory startup check: Legacy compatibility mode: DISABLED | "
        "Inventory bootstrap: DISABLED | Synthetic ledger generation: DISABLED | "
        "Opening balance generation: DISABLED"
    )
    if settings.is_production and settings.jwt_secret_key == "change-this-jwt-secret":
        raise RuntimeError("JWT_SECRET_KEY must be set to a strong secret in production")
    if settings.is_production and settings.auto_create_tables:
        raise RuntimeError("AUTO_CREATE_TABLES must be disabled in production; run migrations instead")
    if not settings.auto_create_tables:
        logger.info("Database auto-create disabled; run migrations before startup")
        notification_worker.start()
        return
    Base.metadata.create_all(bind=engine)
    with engine.begin() as connection:
        connection.execute(text("ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(30)"))
        connection.execute(
            text(
                "UPDATE suppliers SET phone = mobile "
                "WHERE (phone IS NULL OR BTRIM(phone) = '') "
                "AND mobile IS NOT NULL AND BTRIM(mobile) <> ''"
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_suppliers_phone ON suppliers (phone)"))
        connection.execute(
            text(
                "CREATE INDEX IF NOT EXISTS ix_suppliers_business_phone "
                "ON suppliers (business_profile_id, phone)"
            )
        )
        if engine.dialect.name == "postgresql":
            connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_products_business_normalized_name "
                    "ON products (COALESCE(business_profile_id, 0), LOWER(REGEXP_REPLACE(BTRIM(name), '\\s+', ' ', 'g'))) "
                    "WHERE is_active = TRUE"
                )
            )
        connection.execute(
            text("ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)")
        )
        connection.execute(
            text("ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS role VARCHAR(20)")
        )
        connection.execute(
            text("ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS access_code VARCHAR(80)")
        )
        connection.execute(text("ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS logo_url VARCHAR(255)"))
        connection.execute(text("ALTER TABLE business_profiles ADD COLUMN IF NOT EXISTS logo_path VARCHAR(255)"))
        connection.execute(
            text(
                "UPDATE business_profiles "
                "SET logo_url = '/api/v1/business-profile/' || id::text || '/logo-file?v=' || EXTRACT(EPOCH FROM updated_at)::bigint::text "
                "WHERE logo_path IS NOT NULL "
                "AND logo_path <> '' "
                "AND (logo_url IS NULL OR logo_url NOT LIKE '/api/v1/business-profile/%')"
            )
        )
        connection.execute(
            text(
                "UPDATE business_profiles "
                "SET role = COALESCE(role, 'admin'), "
                "access_code = COALESCE(access_code, 'ADM-' || id::text) "
                "WHERE role IS NULL OR access_code IS NULL"
            )
        )
        connection.execute(text("ALTER TABLE business_profiles ALTER COLUMN role SET DEFAULT 'admin'"))
        connection.execute(text("ALTER TABLE business_profiles ALTER COLUMN role SET NOT NULL"))
        connection.execute(text("ALTER TABLE business_profiles ALTER COLUMN access_code SET NOT NULL"))
        connection.execute(
            text(
                "CREATE UNIQUE INDEX IF NOT EXISTS ix_business_profiles_access_code "
                "ON business_profiles (access_code)"
            )
        )
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS role VARCHAR(20)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS access_code VARCHAR(80)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS legal_name VARCHAR(200)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS trade_name VARCHAR(200)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS logo_text VARCHAR(20)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS owner_name VARCHAR(120)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS mobile VARCHAR(30)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS email VARCHAR(150)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS gstin VARCHAR(30)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS pan VARCHAR(20)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS cin VARCHAR(40)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS business_type VARCHAR(100)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS tax_type VARCHAR(50)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS currency VARCHAR(10)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS financial_year VARCHAR(20)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS bank_name VARCHAR(120)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS account_number VARCHAR(60)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS ifsc VARCHAR(30)"))
        connection.execute(text("ALTER TABLE outlets ADD COLUMN IF NOT EXISTS upi_id VARCHAR(80)"))
        connection.execute(
            text(
                "UPDATE outlets "
                "SET role = COALESCE(role, 'outlet'), "
                "access_code = COALESCE(access_code, 'OUT-' || id::text) "
                "WHERE role IS NULL OR access_code IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE outlets "
                "SET legal_name = COALESCE(legal_name, name), "
                "trade_name = COALESCE(trade_name, name), "
                "logo_text = COALESCE(logo_text, 'ERP'), "
                "owner_name = COALESCE(owner_name, COALESCE(manager_name, 'Outlet Admin')), "
                "mobile = COALESCE(mobile, ''), "
                "email = COALESCE(email, ''), "
                "tax_type = COALESCE(tax_type, 'Regular GST'), "
                "currency = COALESCE(currency, 'INR'), "
                "financial_year = COALESCE(financial_year, '2026-2027') "
                "WHERE legal_name IS NULL "
                "OR trade_name IS NULL "
                "OR logo_text IS NULL "
                "OR owner_name IS NULL "
                "OR mobile IS NULL "
                "OR email IS NULL "
                "OR tax_type IS NULL "
                "OR currency IS NULL "
                "OR financial_year IS NULL"
            )
        )
        connection.execute(text("ALTER TABLE outlets ALTER COLUMN role SET DEFAULT 'outlet'"))
        connection.execute(text("ALTER TABLE outlets ALTER COLUMN role SET NOT NULL"))
        connection.execute(text("ALTER TABLE outlets ALTER COLUMN access_code SET NOT NULL"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS ix_outlets_access_code ON outlets (access_code)"))
        connection.execute(text("ALTER TABLE customers ADD COLUMN IF NOT EXISTS is_active BOOLEAN"))
        connection.execute(text("UPDATE customers SET is_active = TRUE WHERE is_active IS NULL"))
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS customer_id INTEGER"))
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS outlet_id INTEGER"))
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS supplier_id INTEGER"))
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS business_profile_id INTEGER"))
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS inventory_applied BOOLEAN"))
        connection.execute(text("ALTER TABLE orders ADD COLUMN IF NOT EXISTS payment_auto_delivered BOOLEAN"))
        connection.execute(text("UPDATE orders SET inventory_applied = TRUE WHERE inventory_applied IS NULL"))
        connection.execute(text("UPDATE orders SET payment_auto_delivered = FALSE WHERE payment_auto_delivered IS NULL"))
        connection.execute(text("ALTER TABLE orders ALTER COLUMN customer_id DROP NOT NULL"))
        connection.execute(text("ALTER TABLE orders ALTER COLUMN outlet_id DROP NOT NULL"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS business_profile_id INTEGER"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS business_profile_id INTEGER"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12, 2) NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_percentage NUMERIC(7, 2) NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'Unpaid'"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMPTZ"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN qty_bought TYPE NUMERIC(12, 3) USING qty_bought::numeric"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN qty_sold TYPE NUMERIC(12, 3) USING qty_sold::numeric"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN reorder_level TYPE NUMERIC(12, 3) USING reorder_level::numeric"))
        connection.execute(text("ALTER TABLE order_items ALTER COLUMN quantity TYPE NUMERIC(12, 3) USING quantity::numeric"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_type VARCHAR(40)"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS category_id INTEGER"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS supplier_id INTEGER"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS unit_label VARCHAR(60)"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS package_size NUMERIC(12, 3)"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS package_size_unit VARCHAR(40)"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS package_price NUMERIC(12, 2)"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS quantity_options TEXT"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS barcode VARCHAR(80)"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS stock_cached NUMERIC(14, 3) NOT NULL DEFAULT 0"))
        connection.execute(text("ALTER TABLE products ADD COLUMN IF NOT EXISTS is_active BOOLEAN"))
        connection.execute(text("UPDATE products SET is_active = TRUE WHERE is_active IS NULL"))
        connection.execute(text("UPDATE products SET barcode = sku WHERE barcode IS NULL OR barcode = ''"))
        connection.execute(text("ALTER TABLE products DROP CONSTRAINT IF EXISTS ix_products_sku"))
        connection.execute(text("DROP INDEX IF EXISTS ix_products_sku"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_sku ON products (sku)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_barcode ON products (barcode)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_name ON products (name)"))
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS inventory_ledger ("
                "id SERIAL PRIMARY KEY, "
                "product_id INTEGER NOT NULL REFERENCES products(id) ON DELETE CASCADE, "
                "business_profile_id INTEGER NULL REFERENCES business_profiles(id), "
                "outlet_id INTEGER NULL REFERENCES outlets(id), "
                "type VARCHAR(30) NOT NULL, "
                "quantity NUMERIC(12, 3) NOT NULL, "
                "idempotency_key TEXT NULL, "
                "user_id VARCHAR(80) NULL, "
                "source VARCHAR(40) NULL, "
                "reference_type VARCHAR(40) NULL, "
                "reference_id VARCHAR(80) NULL, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
                "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
                ")"
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_product_id ON inventory_ledger (product_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_business_profile_id ON inventory_ledger (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_outlet_id ON inventory_ledger (outlet_id)"))
        connection.execute(text("ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS idempotency_key TEXT"))
        connection.execute(text("ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS user_id VARCHAR(80)"))
        connection.execute(text("ALTER TABLE inventory_ledger ADD COLUMN IF NOT EXISTS source VARCHAR(40)"))
        connection.execute(text("ALTER TABLE inventory_ledger ALTER COLUMN reference_id TYPE VARCHAR(80) USING reference_id::text"))
        connection.execute(text("CREATE UNIQUE INDEX IF NOT EXISTS uq_inventory_ledger_idempotency_key ON inventory_ledger (idempotency_key) WHERE idempotency_key IS NOT NULL"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_user_id ON inventory_ledger (user_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_source ON inventory_ledger (source)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_inventory_ledger_reference ON inventory_ledger (reference_type, reference_id)"))
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS idempotency_keys ("
                "id SERIAL PRIMARY KEY, "
                "key VARCHAR(255) NOT NULL UNIQUE, "
                "endpoint VARCHAR(255) NOT NULL, "
                "request_hash VARCHAR(64) NOT NULL, "
                "response_body JSONB, "
                "status_code INTEGER NOT NULL DEFAULT 0, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()"
                ")"
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_idempotency_keys_key ON idempotency_keys (key)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_idempotency_keys_endpoint ON idempotency_keys (endpoint)"))
        connection.execute(
            text(
                "DO $$ "
                "BEGIN "
                "IF to_regclass('public.damaged_inventory') IS NOT NULL THEN "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS available_quantity NUMERIC(12, 3); "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS inspected_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS returned_to_supplier_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS inspection_status VARCHAR(60) NOT NULL DEFAULT 'pending'; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS current_workflow_status_id INTEGER; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS lot_number VARCHAR(80); "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS expiry_date DATE; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS purchase_reference_id INTEGER; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS updated_by_staff_id INTEGER; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb; "
                "ALTER TABLE damaged_inventory ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb; "
                "UPDATE damaged_inventory SET available_quantity = quantity WHERE available_quantity IS NULL; "
                "ALTER TABLE damaged_inventory ALTER COLUMN available_quantity SET DEFAULT 0; "
                "ALTER TABLE damaged_inventory ALTER COLUMN available_quantity SET NOT NULL; "
                "CREATE INDEX IF NOT EXISTS ix_damaged_inventory_business_status "
                "ON damaged_inventory (business_profile_id, inspection_status, disposition); "
                "CREATE INDEX IF NOT EXISTS ix_damaged_inventory_product_available "
                "ON damaged_inventory (product_id, available_quantity); "
                "END IF; "
                "END $$;"
            )
        )
        connection.execute(
            text(
                "CREATE TABLE IF NOT EXISTS uploaded_files ("
                "id SERIAL PRIMARY KEY, "
                "business_profile_id INTEGER NULL, "
                "original_name VARCHAR(255) NOT NULL, "
                "stored_name VARCHAR(255) NOT NULL, "
                "file_url VARCHAR(255) NOT NULL, "
                "file_path VARCHAR(500) NOT NULL, "
                "file_type VARCHAR(20) NOT NULL, "
                "row_count INTEGER NOT NULL DEFAULT 0, "
                "is_active BOOLEAN NOT NULL DEFAULT TRUE, "
                "columns_json TEXT NULL, "
                "preview_json TEXT NULL, "
                "rows_json TEXT NULL, "
                "created_at TIMESTAMPTZ NOT NULL DEFAULT now(), "
                "updated_at TIMESTAMPTZ NOT NULL DEFAULT now()"
                ")"
            )
        )
        connection.execute(text("ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS is_active BOOLEAN"))
        connection.execute(text("ALTER TABLE uploaded_files ADD COLUMN IF NOT EXISTS rows_json TEXT"))
        connection.execute(text("UPDATE uploaded_files SET is_active = TRUE WHERE is_active IS NULL"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_uploaded_files_business_profile_id ON uploaded_files (business_profile_id)"))
        connection.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_type VARCHAR(40)"))
        connection.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS unit_label VARCHAR(60)"))
        connection.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS package_count NUMERIC(12, 3)"))
        connection.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS package_size NUMERIC(12, 3)"))
        connection.execute(text("ALTER TABLE order_items ADD COLUMN IF NOT EXISTS package_size_unit VARCHAR(40)"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS invoice_direction VARCHAR(40)"))
        connection.execute(text("ALTER TABLE product_quantities ADD COLUMN IF NOT EXISTS effective_date DATE"))
        connection.execute(text("ALTER TABLE product_quantities ADD COLUMN IF NOT EXISTS old_stock NUMERIC(12, 3)"))
        connection.execute(text("ALTER TABLE product_quantities ADD COLUMN IF NOT EXISTS new_stock NUMERIC(12, 3)"))
        connection.execute(text("ALTER TABLE product_quantities ADD COLUMN IF NOT EXISTS sold_stock NUMERIC(12, 3)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_qualities_product_id ON product_qualities (product_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_qualities_business_profile_id ON product_qualities (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_prices_product_id ON product_prices (product_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_prices_business_profile_id ON product_prices (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_prices_effective_date ON product_prices (product_id, effective_date)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_qualities_product_id ON product_qualities (product_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_qualities_business_profile_id ON product_qualities (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_discounts_product_id ON product_discounts (product_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_discounts_business_profile_id ON product_discounts (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_discounts_start_date ON product_discounts (product_id, start_date)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_prices_product_id ON product_prices (product_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_prices_business_profile_id ON product_prices (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_product_prices_effective_date ON product_prices (product_id, effective_date)"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS linked_invoice_id INTEGER"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS outlet_id INTEGER"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS customer_id INTEGER"))
        connection.execute(text("ALTER TABLE invoices ADD COLUMN IF NOT EXISTS is_reverse BOOLEAN"))
        connection.execute(text("ALTER TABLE waybills ADD COLUMN IF NOT EXISTS transport_mode VARCHAR(40)"))
        connection.execute(text("ALTER TABLE waybills ADD COLUMN IF NOT EXISTS vehicle_number VARCHAR(40)"))
        connection.execute(text("ALTER TABLE waybills ADD COLUMN IF NOT EXISTS from_name VARCHAR(180)"))
        connection.execute(text("ALTER TABLE waybills ADD COLUMN IF NOT EXISTS to_name VARCHAR(180)"))
        connection.execute(
            text(
                "UPDATE invoices "
                "SET invoice_direction = COALESCE(invoice_direction, 'outlet_to_customer'), "
                "is_reverse = COALESCE(is_reverse, FALSE) "
                "WHERE invoice_direction IS NULL OR is_reverse IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE products "
                "SET business_profile_id = (SELECT id FROM business_profiles ORDER BY id ASC LIMIT 1) "
                "WHERE business_profile_id IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE orders "
                "SET business_profile_id = COALESCE("
                "business_profile_id, "
                "(SELECT business_profile_id FROM outlets WHERE outlets.id = orders.outlet_id), "
                "(SELECT id FROM business_profiles ORDER BY id ASC LIMIT 1)"
                ") "
                "WHERE business_profile_id IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE invoices "
                "SET business_profile_id = COALESCE("
                "business_profile_id, "
                "(SELECT business_profile_id FROM outlets WHERE outlets.id = invoices.outlet_id), "
                "(SELECT business_profile_id FROM orders WHERE orders.id = invoices.order_id), "
                "(SELECT id FROM business_profiles ORDER BY id ASC LIMIT 1)"
                ") "
                "WHERE business_profile_id IS NULL"
            )
        )
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_business_profile_id ON products (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_business_sku ON products (business_profile_id, sku)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_category_id ON products (category_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_products_supplier_id ON products (supplier_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_business_profile_id ON orders (business_profile_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_orders_supplier_id ON orders (supplier_id)"))
        connection.execute(text("CREATE INDEX IF NOT EXISTS ix_invoices_business_profile_id ON invoices (business_profile_id)"))
        for category_name in MARKET_CATEGORIES:
            connection.execute(
                text(
                    "INSERT INTO categories (name, description, is_active) "
                    "VALUES (:name, NULL, TRUE) "
                    "ON CONFLICT (name) DO NOTHING"
                ),
                {"name": category_name},
            )
        connection.execute(
            text(
                "INSERT INTO categories (name, description, is_active) "
                "SELECT DISTINCT TRIM(category), NULL, TRUE FROM products "
                "WHERE category IS NOT NULL AND TRIM(category) <> '' "
                "ON CONFLICT (name) DO NOTHING"
            )
        )
        connection.execute(
            text(
                "UPDATE products "
                "SET category_id = categories.id "
                "FROM categories "
                "WHERE products.category_id IS NULL AND LOWER(products.category) = LOWER(categories.name)"
            )
        )
        connection.execute(
            text(
                "UPDATE products "
                "SET unit_type = COALESCE(unit_type, 'pieces'), "
                "unit_label = COALESCE(unit_label, 'Pieces'), "
                "package_size = COALESCE(package_size, 1), "
                "package_size_unit = COALESCE(package_size_unit, 'Unit') "
                "WHERE unit_type IS NULL OR unit_label IS NULL OR package_size IS NULL OR package_size_unit IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE order_items "
                "SET unit_type = COALESCE(unit_type, 'pieces'), "
                "unit_label = COALESCE(unit_label, 'Pieces'), "
                "package_count = COALESCE(package_count, quantity), "
                "package_size = COALESCE(package_size, 1), "
                "package_size_unit = COALESCE(package_size_unit, 'Unit') "
                "WHERE unit_type IS NULL OR unit_label IS NULL OR package_count IS NULL OR package_size IS NULL OR package_size_unit IS NULL"
            )
        )
        connection.execute(
            text(
                "UPDATE waybills "
                "SET transport_mode = COALESCE(transport_mode, 'Unspecified'), "
                "vehicle_number = COALESCE(vehicle_number, ''), "
                "from_name = COALESCE(from_name, ''), "
                "to_name = COALESCE(to_name, '') "
                "WHERE transport_mode IS NULL OR vehicle_number IS NULL OR from_name IS NULL OR to_name IS NULL"
            )
        )
        connection.execute(text("ALTER TABLE invoices ALTER COLUMN invoice_direction SET DEFAULT 'outlet_to_customer'"))
        connection.execute(text("ALTER TABLE invoices ALTER COLUMN invoice_direction SET NOT NULL"))
        connection.execute(text("ALTER TABLE invoices ALTER COLUMN is_reverse SET DEFAULT FALSE"))
        connection.execute(text("ALTER TABLE invoices ALTER COLUMN is_reverse SET NOT NULL"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN unit_type SET DEFAULT 'pieces'"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN unit_type SET NOT NULL"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN unit_label SET DEFAULT 'Pieces'"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN unit_label SET NOT NULL"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN is_active SET DEFAULT TRUE"))
        connection.execute(text("ALTER TABLE products ALTER COLUMN is_active SET NOT NULL"))
        connection.execute(text("ALTER TABLE customers ALTER COLUMN is_active SET DEFAULT TRUE"))
        connection.execute(text("ALTER TABLE customers ALTER COLUMN is_active SET NOT NULL"))
        connection.execute(text("ALTER TABLE uploaded_files ALTER COLUMN is_active SET DEFAULT TRUE"))
        connection.execute(text("ALTER TABLE uploaded_files ALTER COLUMN is_active SET NOT NULL"))
        connection.execute(text("ALTER TABLE order_items ALTER COLUMN unit_type SET DEFAULT 'pieces'"))
        connection.execute(text("ALTER TABLE order_items ALTER COLUMN unit_type SET NOT NULL"))
        connection.execute(text("ALTER TABLE order_items ALTER COLUMN unit_label SET DEFAULT 'Pieces'"))
        connection.execute(text("ALTER TABLE order_items ALTER COLUMN unit_label SET NOT NULL"))
        connection.execute(text("ALTER TABLE orders ALTER COLUMN inventory_applied SET DEFAULT FALSE"))
        connection.execute(text("ALTER TABLE orders ALTER COLUMN inventory_applied SET NOT NULL"))
        connection.execute(text("ALTER TABLE orders ALTER COLUMN payment_auto_delivered SET DEFAULT FALSE"))
        connection.execute(text("ALTER TABLE orders ALTER COLUMN payment_auto_delivered SET NOT NULL"))
    notification_worker.start()
    logger.info("Database tables are ready")


@app.on_event("shutdown")
def stop_background_workers() -> None:
    notification_worker.stop()


@app.middleware("http")
async def request_logging_middleware(request: Request, call_next):
    request_id = str(uuid.uuid4())
    request.state.request_id = request_id
    started_at = perf_counter()
    if request.method == "OPTIONS":
        return Response(status_code=204, headers=cors_response_headers(request))
    if settings.rate_limit_enabled and request.method == "POST":
        limits = {
            "/api/v1/business-profile/login": (10, 60),
            "/api/v1/business-profile": (5, 300),
        }
        rule = limits.get(request.url.path.rstrip("/") or "/")
        if rule:
            maximum, window_seconds = rule
            client_ip = request.client.host if request.client else "unknown"
            now = monotonic()
            key = (client_ip, request.url.path.rstrip("/"))
            with RATE_LIMIT_LOCK:
                bucket = RATE_LIMIT_BUCKETS[key]
                while bucket and bucket[0] <= now - window_seconds:
                    bucket.popleft()
                if len(bucket) >= maximum:
                    return JSONResponse(
                        status_code=429,
                        content={"detail": "Too many attempts. Please wait and try again."},
                        headers={**cors_response_headers(request), "Retry-After": str(window_seconds)},
                    )
                bucket.append(now)
    logger.info(
        "Request start request_id=%s method=%s path=%s",
        request_id,
        request.method,
        request.url.path,
    )
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (perf_counter() - started_at) * 1000
        route_key = f"{request.method}:{request.url.path}:500"
        REQUEST_TOTALS[route_key] += 1
        REQUEST_ERROR_TOTALS[route_key] += 1
        REQUEST_LATENCY_MS[route_key] += duration_ms
        logger.exception(
            "Unhandled request failure request_id=%s method=%s path=%s",
            request_id,
            request.method,
            request.url.path,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": True,
                "message": "Internal server error",
                "path": str(request.url.path),
                "requestId": request_id,
            },
            headers=cors_response_headers(request),
        )
    duration_ms = (perf_counter() - started_at) * 1000
    route_key = f"{request.method}:{request.url.path}:{response.status_code}"
    REQUEST_TOTALS[route_key] += 1
    REQUEST_LATENCY_MS[route_key] += duration_ms
    if response.status_code >= 500:
        REQUEST_ERROR_TOTALS[route_key] += 1
    response.headers["X-Request-ID"] = request_id
    for header, value in cors_response_headers(request).items():
        if header not in response.headers:
            response.headers[header] = value
    logger.info(
        "Request end request_id=%s status=%s duration_ms=%.2f method=%s path=%s",
        request_id,
        response.status_code,
        duration_ms,
        request.method,
        request.url.path,
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    logger.warning(
        "HTTP exception request_id=%s status=%s path=%s detail=%s",
        request_id,
        exc.status_code,
        request.url.path,
        exc.detail,
    )
    return JSONResponse(
        status_code=exc.status_code,
        content={"error": True, "message": exc.detail, "path": str(request.url.path), "requestId": request_id},
        headers=cors_response_headers(request),
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    request_id = getattr(request.state, "request_id", "unknown")
    logger.exception("Unhandled exception request_id=%s path=%s", request_id, request.url.path)
    return JSONResponse(
        status_code=500,
        content={"error": True, "message": "Internal server error", "path": str(request.url.path), "requestId": request_id},
        headers=cors_response_headers(request),
    )


@app.get("/health", tags=["Health"])
def health_check() -> dict[str, object]:
    database_status = "unknown"
    try:
        with engine.connect() as connection:
            connection.execute(text("SELECT 1"))
        database_status = "ok"
    except Exception as exc:
        database_status = "error"
        logger.warning("Health database ping failed: %s", exc)
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": "1.0.0",
        "environment": settings.environment,
        "uptimeSeconds": round(monotonic() - STARTED_AT, 3),
        "database": database_status,
        "notificationWorker": {
            "enabled": settings.notification_worker_enabled,
            "workerStatus": getattr(notification_worker, "_status", "unknown"),
            "lastError": getattr(notification_worker, "_last_error", None),
        },
    }


@app.get("/metrics", tags=["Health"])
def metrics() -> Response:
    lines = [
        "# HELP erp_http_requests_total Total HTTP requests by method, path, and status.",
        "# TYPE erp_http_requests_total counter",
    ]
    for key, count in sorted(REQUEST_TOTALS.items()):
        method, path, status_code = key.split(":", 2)
        lines.append(
            f'erp_http_requests_total{{method="{method}",path="{path}",status="{status_code}"}} {count}'
        )
    lines.extend(
        [
            "# HELP erp_http_request_errors_total Total HTTP 5xx requests by method, path, and status.",
            "# TYPE erp_http_request_errors_total counter",
        ]
    )
    for key, count in sorted(REQUEST_ERROR_TOTALS.items()):
        method, path, status_code = key.split(":", 2)
        lines.append(
            f'erp_http_request_errors_total{{method="{method}",path="{path}",status="{status_code}"}} {count}'
        )
    lines.extend(
        [
            "# HELP erp_http_request_latency_ms_total Cumulative HTTP latency in milliseconds.",
            "# TYPE erp_http_request_latency_ms_total counter",
        ]
    )
    for key, total_ms in sorted(REQUEST_LATENCY_MS.items()):
        method, path, status_code = key.split(":", 2)
        lines.append(
            f'erp_http_request_latency_ms_total{{method="{method}",path="{path}",status="{status_code}"}} {total_ms:.2f}'
        )
    return Response("\n".join(lines) + "\n", media_type="text/plain; version=0.0.4")


app.include_router(api_gateway)
