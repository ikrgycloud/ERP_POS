from datetime import date
from decimal import Decimal
from html import escape
from io import BytesIO
import logging

from fastapi import APIRouter, Depends, Header, HTTPException, Query, Request, status
from fastapi.responses import HTMLResponse, Response
from sqlalchemy import or_, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from app.api.deps import ErpPrincipal, apply_created_range, get_business_profile_id, get_erp_principal
from app.audit import record_audit
from app.database import get_db
from app.idempotency import begin_idempotent_request, complete_idempotent_request
from app.models import (
    Category,
    Order,
    OrderItem,
    Product,
    ProductDiscount,
    ProductPrice,
    ProductQuantity,
    ProductQuality,
    Supplier,
)
from app.product_identifiers import (
    ProductIdentifierError,
    assert_barcode_available,
    generate_product_identifiers,
    normalize_manual_barcode,
    product_integrity_error,
)
from app.product_identity import clean_product_name, find_active_product_by_name
from app.schemas import (
    ApiMessage,
    ProductCreate,
    ProductDiscountCreate,
    ProductDiscountOut,
    ProductDiscountUpdate,
    ProductInventoryValueOut,
    ProductOut,
    ProductPriceCreate,
    ProductPriceOut,
    ProductQuantityOut,
    ProductQualityCreate,
    ProductQualityOut,
    ProductUpdate,
)
from app.services import (
    active_discount_for_product,
    discounted_price,
    ledger_stock,
    product_metrics,
    product_metrics_from_cache,
    product_metrics_from_ledger,
    record_product_quantity,
    retry_on_deadlock,
)

router = APIRouter(prefix="/products", tags=["Products"])
logger = logging.getLogger("erp-backend.products")


def serialize_product(product: Product, db: Session | None = None, *, reconcile_stock: bool = True) -> ProductOut:
    if db is not None and reconcile_stock:
        metrics = product_metrics_from_ledger(db, product)
    elif not reconcile_stock:
        metrics = product_metrics_from_cache(product)
    else:
        metrics = product_metrics(product)
    return ProductOut.model_validate(
        {
            **product.__dict__,
            **metrics,
            "quantity_history": getattr(product, "quantities", []),
            "qualities": getattr(product, "qualities", []),
            "price_history": getattr(product, "price_history", []),
            "discounts": getattr(product, "discounts", []),
        }
    )


def apply_auto_reorder_level(product_data: dict) -> dict:
    reorder_level = product_data.get("reorder_level")
    if reorder_level is None:
        qty_sold = product_data.get("qty_sold") or 0
        product_data["reorder_level"] = max(0, qty_sold)
    else:
        product_data["reorder_level"] = max(0, reorder_level)
    return product_data


def product_barcode_value(product: Product) -> str:
    return product.barcode or product.sku


def resolve_product_masters(db: Session, product_data: dict, business_profile_id: int | None) -> dict:
    category_id = product_data.get("category_id")
    category_name = (product_data.get("category") or "").strip()
    if category_id:
        category = db.get(Category, category_id)
        if not category:
            raise HTTPException(status_code=404, detail="Category not found")
        product_data["category"] = category.name
    elif category_name:
        category = db.query(Category).filter(Category.name.ilike(category_name)).first()
        if not category:
            category = Category(name=category_name, is_active=True)
            db.add(category)
            db.flush()
        product_data["category_id"] = category.id
        product_data["category"] = category.name

    supplier_id = product_data.get("supplier_id")
    supplier_name = (product_data.get("supplier") or "").strip()
    if supplier_id:
        supplier = db.get(Supplier, supplier_id)
        if not supplier:
            raise HTTPException(status_code=404, detail="Supplier not found")
        if business_profile_id is not None and supplier.business_profile_id not in {None, business_profile_id}:
            raise HTTPException(status_code=404, detail="Supplier not found")
        product_data["supplier"] = supplier.name
    elif supplier_name:
        supplier_query = db.query(Supplier).filter(Supplier.name.ilike(supplier_name))
        if business_profile_id is not None:
            supplier_query = supplier_query.filter(Supplier.business_profile_id == business_profile_id)
        supplier = supplier_query.first()
        if not supplier:
            supplier = Supplier(name=supplier_name, business_profile_id=business_profile_id, is_active=True)
            db.add(supplier)
            db.flush()
        product_data["supplier_id"] = supplier.id
        product_data["supplier"] = supplier.name

    return product_data


@router.get("", response_model=list[ProductOut])
def list_products(
    search: str | None = None,
    category: str | None = None,
    supplier: str | None = None,
    low_stock: bool | None = Query(default=None, alias="lowStock"),
    start_date: date | None = Query(default=None, alias="startDate"),
    end_date: date | None = Query(default=None, alias="endDate"),
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[ProductOut]:
    query = db.query(Product).options(
        selectinload(Product.quantities),
        selectinload(Product.qualities),
        selectinload(Product.discounts),
        selectinload(Product.price_history),
    )
    if business_profile_id is not None:
        query = query.filter(Product.business_profile_id == business_profile_id)
    query = query.filter(Product.is_active.is_(True))
    query = apply_created_range(query, Product, start_date, end_date)
    if search:
        pattern = f"%{search}%"
        query = query.filter(
            or_(
                Product.sku == search,
                Product.barcode == search,
                Product.name.ilike(pattern),
            )
        )
    if category:
        query = query.filter(Product.category == category)
    if supplier:
        query = query.filter(Product.supplier == supplier)
    if low_stock is not None:
        low_stock_condition = Product.stock_cached <= Product.reorder_level
        query = query.filter(low_stock_condition if low_stock else ~low_stock_condition)
    if cursor is not None:
        query = query.filter(Product.id < cursor)
        products = query.order_by(Product.id.desc()).limit(limit).all()
        return [serialize_product(product, db, reconcile_stock=False) for product in products]

    products = query.order_by(Product.created_at.desc()).offset(skip).limit(limit).all()
    return [serialize_product(product, db, reconcile_stock=False) for product in products]


@router.get("/{product_id}/inventory-value", response_model=ProductInventoryValueOut)
def get_product_inventory_value(
    product_id: int,
    target_date: date | None = Query(default=None, alias="date"),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductInventoryValueOut:
    today = date.today()
    if target_date is None:
        target_date = today

    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")

    latest_quantity_record = (
        db.query(ProductQuantity)
        .filter(ProductQuantity.product_id == product_id, ProductQuantity.effective_date <= target_date)
        .order_by(ProductQuantity.effective_date.desc(), ProductQuantity.created_at.desc(), ProductQuantity.id.desc())
        .first()
    )
    if latest_quantity_record and latest_quantity_record.remaining_quantity is not None:
        quantity = Decimal(latest_quantity_record.remaining_quantity)
    else:
        quantity = ledger_stock(db, product.id)
    price_record = (
        db.query(ProductPrice)
        .filter(ProductPrice.product_id == product_id, ProductPrice.effective_date <= target_date)
        .order_by(ProductPrice.effective_date.desc(), ProductPrice.created_at.desc())
        .first()
    )
    if price_record:
        price = price_record.buy_price
        price_source = f"history:{price_record.effective_date}"
    else:
        price = product.buy_price
        price_source = "current_product"

    inventory_value = Decimal(quantity) * price
    return ProductInventoryValueOut(
        product_id=product_id,
        date=target_date,
        quantity=Decimal(quantity),
        price=price,
        inventory_value=inventory_value,
        price_source=price_source,
    )


@router.get("/inventory/damaged")
def list_damaged_inventory(
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=200, ge=1, le=500),
    principal: ErpPrincipal = Depends(get_erp_principal),
    db: Session = Depends(get_db),
) -> list[dict]:
    rows = db.execute(
            text(
                """
                SELECT
                    di.id,
                    di.product_id,
                    di.outlet_id,
                    p.name AS product_name,
                    p.sku,
                    p.barcode,
                    p.supplier_id,
                    p.supplier AS supplier_name,
                    di.quantity,
                    di.available_quantity,
                    di.returned_to_supplier_quantity,
                    di.inspected_quantity,
                    di.inspection_status,
                    di.damage_type,
                    di.disposition,
                    di.remarks,
                    di.return_id,
                    r.return_number,
                    r.reason AS return_reason,
                    r.status AS return_status,
                    i.invoice_number,
                    di.created_at
                FROM damaged_inventory di
                JOIN products p ON p.id = di.product_id
                LEFT JOIN returns r ON r.id = di.return_id
                LEFT JOIN invoices i ON i.id = r.original_invoice_id
                WHERE di.business_profile_id = :business_profile_id
                  AND (:outlet_id IS NULL OR di.outlet_id = :outlet_id)
                ORDER BY di.created_at DESC, di.id DESC
                LIMIT :limit OFFSET :skip
                """
            ),
            {
                "business_profile_id": principal.business_profile_id,
                "outlet_id": principal.outlet_id if principal.is_outlet else None,
                "limit": limit,
                "skip": skip,
            },
        ).mappings()

    return [
        {
            "id": row["id"],
            "productId": row["product_id"],
            "outletId": row["outlet_id"],
            "productName": row["product_name"],
            "sku": row["sku"],
            "barcode": row["barcode"],
            "supplierId": row["supplier_id"],
            "supplierName": row["supplier_name"],
            "quantity": row["quantity"],
            "availableQuantity": row["available_quantity"],
            "returnedToSupplierQuantity": row["returned_to_supplier_quantity"],
            "inspectedQuantity": row["inspected_quantity"],
            "inspectionStatus": row["inspection_status"],
            "damageType": row["damage_type"],
            "disposition": row["disposition"],
            "remarks": row["remarks"],
            "returnId": row["return_id"],
            "returnNumber": row["return_number"],
            "returnReason": row["return_reason"],
            "returnStatus": row["return_status"],
            "invoiceNumber": row["invoice_number"],
            "createdAt": row["created_at"],
        }
        for row in rows
    ]


@router.get("/scan/{barcode}")
def scan_product_by_barcode(
    barcode: str,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> dict:
    product = (
        db.query(Product)
        .filter(or_(Product.barcode == barcode, Product.sku == barcode), Product.is_active.is_(True))
        .first()
    )
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    discount = active_discount_for_product(product)
    current_stock = ledger_stock(db, product.id)
    return {
        "id": product.id,
        "productId": product.id,
        "name": product.name,
        "sku": product.sku,
        "barcode": product_barcode_value(product),
        "categoryId": product.category_id,
        "supplierId": product.supplier_id,
        "category": product.category,
        "supplier": product.supplier,
        "price": str(product.sell_price),
        "mrp": str(product.mrp),
        "gstRate": str(product.gst_rate),
        "currentStock": str(current_stock),
        "available": current_stock > 0,
        "discount": str(discount.discount_value) if discount else None,
        "discountType": discount.discount_type if discount else None,
    }


@router.get("/discounts", response_model=list[ProductDiscountOut])
def list_all_product_discounts(
    active_only: bool = Query(default=False, alias="activeOnly"),
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=500, ge=1, le=1000),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[ProductDiscountOut]:
    query = db.query(ProductDiscount).join(Product, Product.id == ProductDiscount.product_id)
    if business_profile_id is not None:
        query = query.filter(Product.business_profile_id == business_profile_id)
    query = query.filter(Product.is_active.is_(True))
    if active_only:
        query = query.filter(ProductDiscount.is_active.is_(True))
    if cursor is not None:
        return query.filter(ProductDiscount.id < cursor).order_by(ProductDiscount.id.desc()).limit(limit).all()
    return query.order_by(ProductDiscount.start_date.desc().nullslast(), ProductDiscount.created_at.desc()).offset(skip).limit(limit).all()


@router.get("/{product_id}", response_model=ProductOut)
def get_product_detail(
    product_id: int,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductOut:
    product = db.get(Product, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return serialize_product(product, db)


def product_qr_payload(product: Product, db: Session | None = None) -> dict:
    metrics = product_metrics_from_ledger(db, product) if db is not None else product_metrics(product)
    remaining = Decimal(metrics["remaining"])
    discount = active_discount_for_product(product)
    final_price = discounted_price(product)
    discount_text = "No discount"
    if discount:
        if discount.discount_type == "percentage":
            discount_text = f"{discount.discount_value}% off"
        else:
            discount_text = f"₹{discount.discount_value} off"
    return {
        "productId": product.id,
        "date": date.today().isoformat(),
        "name": product.name,
        "sku": product.sku,
        "barcode": product_barcode_value(product),
        "category": product.category,
        "supplier": product.supplier,
        "unitLabel": product.unit_label,
        "available": remaining > 0,
        "stockStatus": "Available" if remaining > 0 else "Out of Stock",
        "remaining": str(remaining),
        "qtyBought": str(product.qty_bought),
        "qtySold": str(product.qty_sold),
        "sellPrice": str(product.sell_price),
        "finalPrice": str(final_price),
        "gstRate": str(product.gst_rate),
        "hasDiscount": discount is not None,
        "discountText": discount_text,
        "discount": (
            {
                "id": discount.id,
                "type": discount.discount_type,
                "value": str(discount.discount_value),
                "minQuantity": str(discount.min_quantity),
                "startDate": discount.start_date.isoformat() if discount.start_date else None,
                "endDate": discount.end_date.isoformat() if discount.end_date else None,
                "description": discount.description,
            }
            if discount
            else None
        ),
    }


def product_barcode_payload(product: Product, db: Session | None = None) -> dict:
    metrics = product_metrics_from_ledger(db, product) if db is not None else product_metrics(product)
    remaining = Decimal(metrics["remaining"])
    return {
        "sku": product.sku,
        "barcode": product_barcode_value(product),
        "productId": product.id,
        "name": product.name,
        "category": product.category,
        "available": remaining > 0,
        "remaining": str(remaining),
        "unitLabel": product.unit_label,
    }


@router.get("/{product_id}/qr")
def get_product_qr(product_id: int, request: Request, db: Session = Depends(get_db)) -> Response:
    product = db.get(Product, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    try:
        import qrcode
        import qrcode.image.svg
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="qrcode package is required to generate product QR codes") from exc
    scan_url = str(request.url_for("scan_product_detail", product_id=product_id))
    image = qrcode.make(scan_url, image_factory=qrcode.image.svg.SvgImage)
    buffer = BytesIO()
    image.save(buffer)
    return Response(content=buffer.getvalue(), media_type="image/svg+xml")


@router.get("/{product_id}/barcode")
def get_product_barcode(product_id: int, db: Session = Depends(get_db)) -> Response:
    product = db.get(Product, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    try:
        import barcode
        from barcode.writer import SVGWriter
    except ImportError as exc:
        raise HTTPException(status_code=500, detail="python-barcode package is required to generate product barcodes") from exc

    code128 = barcode.get("code128", product_barcode_value(product), writer=SVGWriter())
    buffer = BytesIO()
    code128.write(
        buffer,
        options={
            "module_width": 0.32,
            "module_height": 18,
            "font_size": 10,
            "text_distance": 4,
            "quiet_zone": 3,
            "write_text": True,
        },
    )
    return Response(content=buffer.getvalue(), media_type="image/svg+xml")


@router.get("/{product_id}/barcode-data")
def get_product_barcode_detail(product_id: int, db: Session = Depends(get_db)) -> dict:
    product = db.get(Product, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product_barcode_payload(product, db)


@router.get("/{product_id}/pos")
def get_product_pos_detail(product_id: int, db: Session = Depends(get_db)) -> dict:
    product = db.get(Product, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    return product_qr_payload(product, db)


@router.get("/{product_id}/scan", response_class=HTMLResponse, name="scan_product_detail")
def scan_product_detail(product_id: int, db: Session = Depends(get_db)) -> HTMLResponse:
    product = db.get(Product, product_id)
    if not product or not product.is_active:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    payload = product_qr_payload(product, db)
    status_color = "#2f8f62" if payload["available"] else "#c65c4c"
    html = f"""
    <!doctype html>
    <html>
      <head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>{escape(payload["name"])}</title>
        <style>
          body {{ font-family: Arial, sans-serif; background: #f7f4ee; color: #22303a; margin: 0; padding: 18px; }}
          .card {{ background: white; border: 1px solid #e4dccf; border-radius: 20px; padding: 18px; max-width: 720px; margin: auto; }}
          h1 {{ margin: 0 0 6px; }}
          .muted {{ color: #6f7b86; }}
          .status {{ background: {status_color}; color: white; border-radius: 999px; display: inline-block; font-weight: 800; margin: 8px 0 0; padding: 8px 12px; }}
          .grid {{ display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; margin-top: 16px; }}
          .box {{ background: #f7f4ee; border-radius: 14px; padding: 12px; }}
          .label {{ color: #6f7b86; font-size: 12px; font-weight: 700; }}
          .value {{ font-size: 18px; font-weight: 900; margin-top: 4px; }}
          .price {{ color: #2f8f62; }}
          .discount {{ color: #c48a2f; }}
          .footer {{ border-top: 1px solid #e4dccf; color: #6f7b86; font-size: 12px; margin-top: 16px; padding-top: 12px; }}
        </style>
      </head>
      <body>
        <div class="card">
          <p class="muted">Product QR Details</p>
          <h1>{escape(payload["name"])}</h1>
          <p class="muted">SKU: {escape(payload["sku"])} - Category: {escape(payload["category"])} - Supplier: {escape(payload["supplier"])}</p>
          <div class="status">{payload["stockStatus"]}</div>
          <div class="grid">
            <div class="box"><div class="label">Date</div><div class="value">{payload["date"]}</div></div>
            <div class="box"><div class="label">SKU Number</div><div class="value">{escape(payload["sku"])}</div></div>
            <div class="box"><div class="label">Available?</div><div class="value">{"Yes" if payload["available"] else "No"}</div></div>
            <div class="box"><div class="label">Products Remaining</div><div class="value">{payload["remaining"]} {escape(payload["unitLabel"] or "")}</div></div>
            <div class="box"><div class="label">Sale Price</div><div class="value price">Rs {payload["sellPrice"]}</div></div>
            <div class="box"><div class="label">Final Price After Discount</div><div class="value price">Rs {payload["finalPrice"]}</div></div>
            <div class="box"><div class="label">Discount Having?</div><div class="value discount">{escape(payload["discountText"])}</div></div>
            <div class="box"><div class="label">Bought Stock</div><div class="value">{payload["qtyBought"]}</div></div>
            <div class="box"><div class="label">Sold Stock</div><div class="value">{payload["qtySold"]}</div></div>
            <div class="box"><div class="label">GST</div><div class="value">{payload["gstRate"]}%</div></div>
            <div class="box"><div class="label">POS JSON</div><div class="value">/api/v1/products/{product.id}/pos</div></div>
          </div>
          <div class="footer">POS scanners can call the JSON endpoint above to get product price, SKU, discount, availability, and remaining stock.</div>
        </div>
      </body>
    </html>
    """
    return HTMLResponse(html)

@router.get("/{product_id}/qualities", response_model=list[ProductQualityOut])
def list_product_qualities(
    product_id: int,
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[ProductQualityOut]:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    query = db.query(ProductQuality).filter(ProductQuality.product_id == product_id)
    if cursor is not None:
        query = query.filter(ProductQuality.id < cursor)
        qualities = query.order_by(ProductQuality.id.desc()).limit(limit).all()
    else:
        qualities = query.order_by(ProductQuality.effective_date.desc(), ProductQuality.created_at.desc()).offset(skip).limit(limit).all()
    return qualities


@router.get("/{product_id}/quantities", response_model=list[ProductQuantityOut])
def list_product_quantities(
    product_id: int,
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[ProductQuantityOut]:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    query = db.query(ProductQuantity).filter(ProductQuantity.product_id == product_id)
    if cursor is not None:
        return query.filter(ProductQuantity.id < cursor).order_by(ProductQuantity.id.desc()).limit(limit).all()
    return query.order_by(ProductQuantity.effective_date.desc(), ProductQuantity.created_at.desc(), ProductQuantity.id.desc()).offset(skip).limit(limit).all()


@router.post("/{product_id}/qualities", response_model=ProductQualityOut, status_code=status.HTTP_201_CREATED)
def create_product_quality(
    product_id: int,
    payload: ProductQualityCreate,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductQualityOut:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    quality_data = payload.model_dump()
    quality_data["product_id"] = product_id
    quality_data["business_profile_id"] = business_profile_id
    quality = ProductQuality(**quality_data)
    db.add(quality)
    db.flush()
    record_audit(db, action="create", entity_type="product_quality", entity_id=quality.id, details=payload.model_dump())
    db.commit()
    db.refresh(quality)
    return quality


@router.get("/{product_id}/prices", response_model=list[ProductPriceOut])
def list_product_prices(
    product_id: int,
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[ProductPriceOut]:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    query = db.query(ProductPrice).filter(ProductPrice.product_id == product_id)
    if cursor is not None:
        prices = query.filter(ProductPrice.id < cursor).order_by(ProductPrice.id.desc()).limit(limit).all()
    else:
        prices = query.order_by(ProductPrice.effective_date.desc(), ProductPrice.created_at.desc()).offset(skip).limit(limit).all()
    return prices


@router.post("/{product_id}/prices", response_model=ProductPriceOut, status_code=status.HTTP_201_CREATED)
def create_product_price(
    product_id: int,
    payload: ProductPriceCreate,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductPriceOut:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    price_data = payload.model_dump()
    price_data["product_id"] = product_id
    price_data["business_profile_id"] = business_profile_id
    price = ProductPrice(**price_data)
    db.add(price)
    db.flush()
    record_audit(db, action="create", entity_type="product_price", entity_id=price.id, details=payload.model_dump())
    db.commit()
    db.refresh(price)
    return price


@router.get("/{product_id}/discounts", response_model=list[ProductDiscountOut])
def list_product_discounts(
    product_id: int,
    active_only: bool = Query(default=False, alias="activeOnly"),
    cursor: int | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=100, ge=1, le=100),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> list[ProductDiscountOut]:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    query = db.query(ProductDiscount).filter(ProductDiscount.product_id == product_id)
    if active_only:
        query = query.filter(ProductDiscount.is_active.is_(True))
    if cursor is not None:
        return query.filter(ProductDiscount.id < cursor).order_by(ProductDiscount.id.desc()).limit(limit).all()
    return query.order_by(ProductDiscount.start_date.desc().nullslast(), ProductDiscount.created_at.desc()).offset(skip).limit(limit).all()


def validate_discount_payload(
    *,
    discount_type: str,
    discount_value,
    start_date,
    end_date,
) -> str:
    normalized_type = (discount_type or "").strip().lower()
    if normalized_type not in {"percentage", "fixed"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount type must be percentage or fixed")
    if normalized_type == "percentage" and discount_value > 100:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Percentage discount cannot exceed 100")
    if discount_value <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Discount value must be greater than 0")
    if not start_date or not end_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Start date and end date are required")
    if end_date < start_date:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="End date must be on or after start date")
    return normalized_type


def ensure_no_overlapping_discount(
    db: Session,
    *,
    product_id: int,
    start_date,
    end_date,
    exclude_discount_id: int | None = None,
) -> None:
    query = db.query(ProductDiscount).filter(
        ProductDiscount.product_id == product_id,
        ProductDiscount.is_active.is_(True),
        ProductDiscount.start_date <= end_date,
        ProductDiscount.end_date >= start_date,
    )
    if exclude_discount_id is not None:
        query = query.filter(ProductDiscount.id != exclude_discount_id)
    if query.first():
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail="Another active discount already overlaps this date range for this product",
        )


@router.post("/{product_id}/discounts", response_model=ProductDiscountOut, status_code=status.HTTP_201_CREATED)
def create_product_discount(
    product_id: int,
    payload: ProductDiscountCreate,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductDiscountOut:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    discount_type = validate_discount_payload(
        discount_type=payload.discount_type,
        discount_value=payload.discount_value,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    if payload.is_active:
        ensure_no_overlapping_discount(db, product_id=product_id, start_date=payload.start_date, end_date=payload.end_date)
    discount_data = payload.model_dump()
    discount_data["discount_type"] = discount_type
    discount_data["product_id"] = product_id
    discount_data["business_profile_id"] = business_profile_id
    discount = ProductDiscount(**discount_data)
    db.add(discount)
    db.flush()
    record_audit(
        db,
        action="create",
        entity_type="product_discount",
        entity_id=discount.id,
        details=payload.model_dump(),
    )
    db.commit()
    db.refresh(discount)
    return discount


@router.put("/{product_id}/discounts/{discount_id}", response_model=ProductDiscountOut)
def update_product_discount(
    product_id: int,
    discount_id: int,
    payload: ProductDiscountUpdate,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductDiscountOut:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    discount = db.query(ProductDiscount).filter(ProductDiscount.id == discount_id, ProductDiscount.product_id == product_id).first()
    if not discount:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found")

    data = payload.model_dump(exclude_unset=True)
    next_type = data.get("discount_type", discount.discount_type)
    next_value = data.get("discount_value", discount.discount_value)
    next_start = data.get("start_date", discount.start_date)
    next_end = data.get("end_date", discount.end_date)
    next_active = data.get("is_active", discount.is_active)
    normalized_type = validate_discount_payload(
        discount_type=next_type,
        discount_value=next_value,
        start_date=next_start,
        end_date=next_end,
    )
    if next_active:
        ensure_no_overlapping_discount(
            db,
            product_id=product_id,
            start_date=next_start,
            end_date=next_end,
            exclude_discount_id=discount_id,
        )
    data["discount_type"] = normalized_type
    for key, value in data.items():
        setattr(discount, key, value)
    record_audit(db, action="update", entity_type="product_discount", entity_id=discount.id, details=data)
    db.commit()
    db.refresh(discount)
    return discount


@router.delete("/{product_id}/discounts/{discount_id}", response_model=ProductDiscountOut)
def deactivate_product_discount(
    product_id: int,
    discount_id: int,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductDiscountOut:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    discount = db.query(ProductDiscount).filter(ProductDiscount.id == discount_id, ProductDiscount.product_id == product_id).first()
    if not discount:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found")
    discount.is_active = False
    record_audit(db, action="deactivate", entity_type="product_discount", entity_id=discount.id, details={"is_active": False})
    db.commit()
    db.refresh(discount)
    return discount


@router.delete("/{product_id}/discounts/{discount_id}/hard", response_model=ApiMessage)
def delete_product_discount(
    product_id: int,
    discount_id: int,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ApiMessage:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Product not found")
    discount = db.query(ProductDiscount).filter(ProductDiscount.id == discount_id, ProductDiscount.product_id == product_id).first()
    if not discount:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Discount not found")
    record_audit(
        db,
        action="delete",
        entity_type="product_discount",
        entity_id=discount.id,
        details={
            "product_id": product_id,
            "discount_type": discount.discount_type,
            "discount_value": str(discount.discount_value),
        },
    )
    db.delete(discount)
    db.commit()
    return ApiMessage(message="Discount deleted successfully")


@router.post("", response_model=ProductOut, status_code=status.HTTP_201_CREATED)
@retry_on_deadlock()
def create_product(
    payload: ProductCreate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductOut:
    idem = begin_idempotent_request(db, idempotency_key, "ERP:POST:/products", payload.model_dump())
    if idem.replay_body is not None:
        return idem.replay_body
    product_data = payload.model_dump()
    product_data.pop("sku", None)
    product_data["name"] = clean_product_name(product_data.get("name"))
    product_data["business_profile_id"] = business_profile_id
    product_data = resolve_product_masters(db, product_data, business_profile_id)
    duplicate = find_active_product_by_name(
        db,
        name=product_data["name"],
        business_profile_id=business_profile_id,
        lock=True,
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "PRODUCT_ALREADY_EXISTS",
                "message": f"{duplicate.name} already exists as {duplicate.sku}",
                "productId": duplicate.id,
            },
        )
    try:
        manual_barcode = normalize_manual_barcode(product_data.get("barcode"))
        identifiers = generate_product_identifiers(db, business_profile_id)
        product_data["sku"] = identifiers.sku
        if manual_barcode:
            assert_barcode_available(
                db,
                barcode=manual_barcode,
                business_profile_id=business_profile_id,
            )
            product_data["barcode"] = manual_barcode
        else:
            product_data["barcode"] = identifiers.barcode
    except ProductIdentifierError as exc:
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc
    product_data = apply_auto_reorder_level(product_data)
    product_data["stock_cached"] = Decimal("0")
    product = Product(**product_data)
    db.add(product)
    try:
        db.flush()
        # Record opening purchases and already-sold units as separate ledger
        # movements.  A single net opening movement looks like a purchase to
        # the ledger and can subsequently be combined with the product-level
        # sold counter, causing available stock to be counted twice.
        if product.qty_bought:
            record_product_quantity(
                db,
                product,
                transaction_type="opening_stock",
                quantity_change=Decimal(product.qty_bought),
                old_stock=Decimal("0"),
                new_stock=Decimal(product.qty_bought),
                sold_stock=Decimal("0"),
                remaining_quantity=Decimal(product.qty_bought),
                note="Initial product stock",
            )
        if product.qty_sold:
            record_product_quantity(
                db,
                product,
                transaction_type="sale_delivered",
                quantity_change=-Decimal(product.qty_sold),
                old_stock=Decimal(product.qty_bought),
                new_stock=Decimal(product.qty_bought),
                sold_stock=Decimal(product.qty_sold),
                remaining_quantity=Decimal(product.qty_bought) - Decimal(product.qty_sold),
                note="Initial sold quantity",
            )
        db.add(
            ProductPrice(
                product_id=product.id,
                business_profile_id=business_profile_id,
                effective_date=date.today(),
                mrp=product.mrp,
                buy_price=product.buy_price,
                sell_price=product.sell_price,
                source="product_create",
                note="Initial product price",
            )
        )
        record_audit(db, action="create", entity_type="product", entity_id=product.id, details=payload.model_dump())
        db.flush()
        db.refresh(product)
        complete_idempotent_request(idem, serialize_product(product, db), status.HTTP_201_CREATED)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        identifier_error = product_integrity_error(exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT if identifier_error.code == "PRODUCT_ALREADY_EXISTS" else 400,
            detail={"code": identifier_error.code, "message": identifier_error.message},
        ) from exc
    db.refresh(product)
    return serialize_product(product, db)


@router.put("/{product_id}", response_model=ProductOut)
@retry_on_deadlock()
def update_product(
    product_id: int,
    payload: ProductUpdate,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ProductOut:
    idem = begin_idempotent_request(
        db,
        idempotency_key,
        f"ERP:PUT:/products/{product_id}",
        {"product_id": product_id, **payload.model_dump()},
    )
    if idem.replay_body is not None:
        return idem.replay_body
    product = db.query(Product).filter(Product.id == product_id).with_for_update().first()
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=404, detail="Product not found")
    product_data = payload.model_dump()
    product_data.pop("sku", None)
    try:
        if "barcode" in product_data:
            manual_barcode = normalize_manual_barcode(product_data.get("barcode"))
            if manual_barcode:
                assert_barcode_available(
                    db,
                    barcode=manual_barcode,
                    business_profile_id=business_profile_id,
                    exclude_product_id=product.id,
                )
                product_data["barcode"] = manual_barcode
            else:
                product_data.pop("barcode", None)
    except ProductIdentifierError as exc:
        raise HTTPException(status_code=400, detail={"code": exc.code, "message": exc.message}) from exc
    product_data = resolve_product_masters(db, product_data, business_profile_id)
    product_data["name"] = clean_product_name(product_data.get("name"))
    duplicate = find_active_product_by_name(
        db,
        name=product_data["name"],
        business_profile_id=business_profile_id,
        exclude_product_id=product.id,
        lock=True,
    )
    if duplicate:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail={
                "code": "PRODUCT_ALREADY_EXISTS",
                "message": f"{duplicate.name} already exists as {duplicate.sku}",
                "productId": duplicate.id,
            },
        )
    product_data = apply_auto_reorder_level(product_data)
    old_bought = Decimal(product.qty_bought)
    old_sold = Decimal(product.qty_sold)
    old_mrp = Decimal(product.mrp)
    old_buy_price = Decimal(product.buy_price)
    old_sell_price = Decimal(product.sell_price)
    for key, value in product_data.items():
        setattr(product, key, value)
    try:
        db.flush()
        new_bought = Decimal(product.qty_bought)
        new_sold = Decimal(product.qty_sold)
        if new_bought != old_bought or new_sold != old_sold:
            bought_delta = new_bought - old_bought
            record_product_quantity(
                db,
                product,
                transaction_type="manual_adjustment",
                quantity_change=(new_bought - new_sold) - (old_bought - old_sold),
                old_stock=old_bought,
                new_stock=bought_delta if bought_delta > 0 else new_bought,
                sold_stock=new_sold,
                remaining_quantity=new_bought - new_sold,
                note="Product stock edited manually",
                idempotency_key=(
                    f"ERP:PRODUCT_UPDATE:{product.id}:"
                    f"{old_bought}->{new_bought}:"
                    f"{old_sold}->{new_sold}"
                ),
            )
        if (
            Decimal(product.mrp) != old_mrp
            or Decimal(product.buy_price) != old_buy_price
            or Decimal(product.sell_price) != old_sell_price
        ):
            db.add(
                ProductPrice(
                    product_id=product.id,
                    business_profile_id=business_profile_id,
                    effective_date=date.today(),
                    mrp=product.mrp,
                    buy_price=product.buy_price,
                    sell_price=product.sell_price,
                    source="product_update",
                    note=(
                        f"MRP {old_mrp} -> {product.mrp}; "
                        f"Buy {old_buy_price} -> {product.buy_price}; "
                        f"Sell {old_sell_price} -> {product.sell_price}"
                    ),
                )
        )
        record_audit(db, action="update", entity_type="product", entity_id=product.id, details=payload.model_dump())
        db.flush()
        db.refresh(product)
        complete_idempotent_request(idem, serialize_product(product, db), status.HTTP_200_OK)
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        identifier_error = product_integrity_error(exc)
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT if identifier_error.code == "PRODUCT_ALREADY_EXISTS" else 400,
            detail={"code": identifier_error.code, "message": identifier_error.message},
        ) from exc
    db.refresh(product)
    return serialize_product(product, db)


@router.delete("/{product_id}", response_model=ApiMessage)
@retry_on_deadlock()
def delete_product(
    product_id: int,
    business_profile_id: int | None = Depends(get_business_profile_id),
    db: Session = Depends(get_db),
) -> ApiMessage:
    product = db.get(Product, product_id)
    if not product:
        raise HTTPException(status_code=404, detail="Product not found")
    if business_profile_id is not None and product.business_profile_id != business_profile_id:
        raise HTTPException(status_code=404, detail="Product not found")
    product.is_active = False
    record_audit(db, action="archive", entity_type="product", entity_id=product.id, details={"sku": product.sku})
    try:
        db.commit()
    except IntegrityError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail="Product delete failed") from exc
    return ApiMessage(message="Product deleted")

