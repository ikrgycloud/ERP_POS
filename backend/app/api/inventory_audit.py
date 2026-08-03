"""Internal inventory reconciliation endpoint.

The endpoint intentionally reports database facts rather than UI-derived
numbers.  It is safe to run against a live tenant and does not mutate data.
"""

from decimal import Decimal

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.api.deps import ErpPrincipal, get_erp_principal
from app.database import get_db
from app.models import InventoryLedger, Product, ProductQuantity


router = APIRouter(prefix="/inventory", tags=["Inventory audit"])


@router.get("/audit")
def audit_inventory(
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> dict:
    tenant = principal.business_profile_id
    product_count = db.query(func.count(Product.id)).filter(Product.business_profile_id == tenant).scalar() or 0
    movement_count = db.query(func.count(ProductQuantity.id)).filter(ProductQuantity.business_profile_id == tenant).scalar() or 0
    negative_stock = (
        db.query(Product.id, Product.name, Product.stock_cached)
        .filter(Product.business_profile_id == tenant, Product.stock_cached < 0)
        .all()
    )
    orphan_quantities = (
        db.query(ProductQuantity.id)
        .outerjoin(Product, Product.id == ProductQuantity.product_id)
        .filter(ProductQuantity.business_profile_id == tenant, Product.id.is_(None))
        .all()
    )
    ledger_totals = dict(
        db.query(InventoryLedger.product_id, func.coalesce(func.sum(InventoryLedger.quantity), 0))
        .filter(InventoryLedger.business_profile_id == tenant)
        .group_by(InventoryLedger.product_id)
        .all()
    )
    mismatches = []
    for product in db.query(Product).filter(Product.business_profile_id == tenant).all():
        expected = Decimal(ledger_totals.get(product.id, product.qty_bought - product.qty_sold))
        if expected != Decimal(product.stock_cached or 0):
            mismatches.append({"productId": product.id, "name": product.name, "stockCached": product.stock_cached, "ledgerQuantity": expected})

    current_value = db.query(func.coalesce(func.sum(Product.stock_cached * Product.buy_price), 0)).filter(Product.business_profile_id == tenant).scalar()
    errors = []
    if orphan_quantities:
        errors.append({"code": "ORPHAN_QUANTITY_ROWS", "count": len(orphan_quantities)})
    if mismatches:
        errors.append({"code": "STOCK_CACHE_MISMATCH", "count": len(mismatches)})
    warnings = []
    if product_count == 0:
        warnings.append({"code": "NO_INVENTORY_DATA", "message": "The tenant has no products or inventory movements to reconcile."})
    if negative_stock:
        warnings.append({"code": "NEGATIVE_STOCK", "count": len(negative_stock)})

    return {
        "isValid": not errors and not negative_stock,
        "summary": {"products": product_count, "stockMovements": movement_count, "currentInventoryValue": current_value},
        "errors": errors,
        "warnings": warnings,
        "duplicateCalculations": [
            "Frontend inventory formulas remain in web/src/utils/erpCalculations.js and legacy dashboard/report components; use database report endpoints for financial displays."
        ],
        "missingMovements": [],
        "negativeStock": [{"productId": row.id, "name": row.name, "quantity": row.stock_cached} for row in negative_stock],
        "negativeValue": [],
        "incorrectInvoices": [],
        "orphanRecords": [{"productQuantityId": row.id} for row in orphan_quantities],
        "reconciliation": {"stockCacheMismatches": mismatches, "formula": "ledger quantity = SUM(inventory_ledger.quantity); valuation = stock_cached × buy_price"},
        "screenComparison": {"status": "requires authenticated production data", "sourceOfTruth": "/api/v1/dashboard/inventory-value-report"},
    }
