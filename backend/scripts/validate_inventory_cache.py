from __future__ import annotations

import sys
from pathlib import Path

from sqlalchemy import create_engine, text

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.config import get_settings  # noqa: E402


def main() -> int:
    settings = get_settings()
    engine = create_engine(settings.database_url, pool_pre_ping=True)
    query = text(
        """
        SELECT
            p.id,
            p.sku,
            p.name,
            p.stock_cached,
            COALESCE(SUM(il.quantity), 0) AS ledger_stock,
            p.stock_cached - COALESCE(SUM(il.quantity), 0) AS difference
        FROM products p
        LEFT JOIN inventory_ledger il ON il.product_id = p.id
        GROUP BY p.id, p.sku, p.name, p.stock_cached
        HAVING p.stock_cached <> COALESCE(SUM(il.quantity), 0)
        ORDER BY ABS(p.stock_cached - COALESCE(SUM(il.quantity), 0)) DESC, p.id
        """
    )
    with engine.connect() as connection:
        rows = connection.execute(query).mappings().all()

    if not rows:
        print("OK: products.stock_cached matches inventory_ledger sums.")
        return 0

    print(f"ERROR: {len(rows)} inventory cache mismatches found.")
    for row in rows:
        print(
            f"product_id={row['id']} sku={row['sku']} "
            f"cached={row['stock_cached']} ledger={row['ledger_stock']} "
            f"diff={row['difference']} name={row['name']}"
        )
    return 1


if __name__ == "__main__":
    raise SystemExit(main())
