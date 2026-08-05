"""Catalog, inventory, and customer endpoints."""
import logging
from datetime import date, timedelta
from decimal import Decimal

from fastapi import APIRouter, Depends, Header, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser, get_current_user, require_roles
from app.api.pagination import PaginationParams, pagination_params
from app.core.config import settings
from app.core.exceptions import ConflictError, NotFoundError
from app.core.roles import Role
from app.db.session import get_db
from app.repositories.repos import (
    CategoryRepository,
    CustomerRepository,
    DamagedInventoryRepository,
    ProductDiscountRepository,
    ProductQuantityRepository,
    ProductRepository,
    SupplierRepository,
)
from app.models.catalog import InventoryLedger, ProductDiscount
from app.schemas.common import Message
from app.services.idempotency import begin_idempotent_request, complete_idempotent_request
from app.services.common import retry_on_deadlock
from app.schemas.masters import (
    CategoryCreate,
    CategoryOut,
    CategoryUpdate,
    CustomerCreate,
    CustomerOut,
    CustomerUpdate,
    DiscountCreate,
    DiscountOut,
    ProductCreate,
    ProductOut,
    ProductQuantityOut,
    ProductUpdate,
    ScanResult,
    StockAdjustment,
    SupplierCreate,
    SupplierOut,
    SupplierUpdate,
)
from app.utils.helpers import discount_pct_for_price, line_total
from shared_domain.inventory import (
    InventoryMovement,
    InventoryMovementService,
    InventoryMovementType,
)

router = APIRouter(tags=["catalog"])

BM = require_roles(Role.BRANCH_MANAGER)
BM_SM = require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER)
BM_SM_SP = require_roles(Role.BRANCH_MANAGER, Role.SALES_MANAGER, Role.SALES_PERSON)
logger = logging.getLogger("pos_api.inventory")


def validate_discount_payload(payload: DiscountCreate) -> str:
    discount_type = (payload.discount_type or "").strip().lower()
    if discount_type not in {"percentage", "fixed"}:
        raise ConflictError("Discount type must be percentage or fixed", code="INVALID_DISCOUNT")
    if payload.discount_value <= 0:
        raise ConflictError("Discount value must be greater than 0", code="INVALID_DISCOUNT")
    if discount_type == "percentage" and payload.discount_value > 100:
        raise ConflictError("Percentage discount cannot exceed 100", code="INVALID_DISCOUNT")
    if payload.end_date < payload.start_date:
        raise ConflictError("End date must be on or after start date", code="INVALID_DISCOUNT")
    return discount_type


async def ensure_no_overlapping_discount(
    db: AsyncSession,
    *,
    product_id: int,
    start_date: date,
    end_date: date,
) -> None:
    stmt = select(ProductDiscount).where(
        ProductDiscount.product_id == product_id,
        ProductDiscount.is_active.is_(True),
        ProductDiscount.start_date <= end_date,
        ProductDiscount.end_date >= start_date,
    )
    if (await db.execute(stmt)).scalars().first():
        raise ConflictError(
            "Another active discount already overlaps this date range for this product",
            code="DISCOUNT_OVERLAP",
        )


# ------------------------------ Categories ------------------------------
@router.get("/categories", response_model=list[CategoryOut])
async def list_categories(db: AsyncSession = Depends(get_db), user=Depends(get_current_user)):
    return await CategoryRepository(db).list(limit=200)


@router.post("/categories", response_model=CategoryOut, status_code=201)
async def create_category(payload: CategoryCreate, db: AsyncSession = Depends(get_db), user=Depends(BM)):
    repo = CategoryRepository(db)
    if await repo.get_by(name=payload.name):
        raise ConflictError("Category name already exists")
    return await repo.create(**payload.model_dump())


@router.put("/categories/{cat_id}", response_model=CategoryOut)
async def update_category(cat_id: int, payload: CategoryUpdate, db: AsyncSession = Depends(get_db), user=Depends(BM)):
    repo = CategoryRepository(db)
    obj = await repo.get(cat_id)
    if not obj:
        raise NotFoundError("Category not found")
    return await repo.update(obj, **payload.model_dump(exclude_unset=True))


@router.delete("/categories/{cat_id}", response_model=Message)
async def delete_category(cat_id: int, db: AsyncSession = Depends(get_db), user=Depends(BM)):
    repo = CategoryRepository(db)
    obj = await repo.get(cat_id)
    if not obj:
        raise NotFoundError("Category not found")
    await repo.delete(obj)
    return Message(detail="Category deleted")


# ------------------------------ Suppliers ------------------------------
@router.get("/suppliers", response_model=list[SupplierOut])
async def list_suppliers(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM)):
    return await SupplierRepository(db).list(
        limit=200,
        business_profile_id=user.business_profile_id,
    )


@router.post("/suppliers", response_model=SupplierOut, status_code=201)
async def create_supplier(payload: SupplierCreate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM)):
    return await SupplierRepository(db).create(
        business_profile_id=user.business_profile_id, **payload.model_dump()
    )


@router.put("/suppliers/{sid}", response_model=SupplierOut)
async def update_supplier(sid: int, payload: SupplierUpdate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM)):
    repo = SupplierRepository(db)
    obj = await repo.get(sid)
    if not obj or obj.business_profile_id != user.business_profile_id:
        raise NotFoundError("Supplier not found")
    return await repo.update(obj, **payload.model_dump(exclude_unset=True))


# ------------------------------ Products ------------------------------
@router.get("/products", response_model=list[ProductOut])
async def list_products(
    q: str | None = None,
    pagination: PaginationParams = Depends(pagination_params),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(get_current_user),
):
    return await ProductRepository(db).search(
        q,
        pagination.skip,
        pagination.limit,
        business_profile_id=None if settings.POS_GLOBAL_PRODUCT_CATALOG else user.business_profile_id,
        cursor=pagination.cursor,
    )


@router.get("/products/barcode/{barcode}", response_model=ScanResult)
async def scan_product(
    barcode: str,
    quantity: Decimal = Decimal("1"),
    db: AsyncSession = Depends(get_db),
    user=Depends(require_roles(Role.SALES_PERSON)),
):
    product = await ProductRepository(db).get_by_scan_code(
        barcode,
        business_profile_id=None if settings.POS_GLOBAL_PRODUCT_CATALOG else user.business_profile_id,
    )
    if not product or not product.is_active:
        raise NotFoundError(f"No product for barcode {barcode}")
    current_stock = await ProductRepository(db).stock_on_hand(product.id)
    if current_stock < quantity:
        raise ConflictError("Insufficient stock for this product", code="INSUFFICIENT_STOCK")
    disc = await ProductDiscountRepository(db).active_for_product(
        product.id, quantity, date.today(), Decimal(str(product.sell_price))
    )
    disc_pct = (
        discount_pct_for_price(disc.discount_type, disc.discount_value, Decimal(str(product.sell_price)))
        if disc
        else Decimal("0")
    )
    return ScanResult(
        product_id=product.id,
        product_name=product.name,
        quantity=quantity,
        current_stock=current_stock,
        price=Decimal(str(product.sell_price)),
        discount_pct=disc_pct,
        gst_rate=Decimal(str(product.gst_rate)),
        total=line_total(product.sell_price, quantity, disc_pct),
    )


@router.get("/products/{pid}", response_model=ProductOut)
async def get_product(pid: int, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    obj = await ProductRepository(db).get(pid)
    if not obj or (
        not settings.POS_GLOBAL_PRODUCT_CATALOG
        and obj.business_profile_id != user.business_profile_id
    ):
        raise NotFoundError("Product not found")
    return obj


@router.post("/products", response_model=ProductOut, status_code=201)
async def create_product(payload: ProductCreate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM)):
    repo = ProductRepository(db)
    if await repo.get_by_sku(payload.sku, user.business_profile_id):
        raise ConflictError("SKU already exists")
    if payload.barcode and await repo.get_by_barcode(payload.barcode, user.business_profile_id):
        raise ConflictError("Barcode already exists")
    data = payload.model_dump()
    data["stock_cached"] = data.get("qty_bought", 0)
    return await repo.create(business_profile_id=user.business_profile_id, **data)


@router.put("/products/{pid}", response_model=ProductOut)
async def update_product(pid: int, payload: ProductUpdate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM)):
    repo = ProductRepository(db)
    obj = await repo.get(pid)
    if not obj or obj.business_profile_id != user.business_profile_id:
        raise NotFoundError("Product not found")
    return await repo.update(obj, **payload.model_dump(exclude_unset=True))


@router.post("/products/{pid}/discounts", response_model=DiscountOut, status_code=201)
async def add_discount(pid: int, payload: DiscountCreate, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM)):
    product = await ProductRepository(db).get(pid)
    if not product or product.business_profile_id != user.business_profile_id:
        raise NotFoundError("Product not found")
    if payload.start_date is None or payload.end_date is None:
        payload = payload.model_copy(
            update={
                "start_date": payload.start_date or date.today(),
                "end_date": payload.end_date or (payload.start_date or date.today()) + timedelta(days=365),
            }
        )
    discount_type = validate_discount_payload(payload)
    await ensure_no_overlapping_discount(
        db,
        product_id=pid,
        start_date=payload.start_date,
        end_date=payload.end_date,
    )
    data = payload.model_dump()
    data["discount_type"] = discount_type
    return await ProductDiscountRepository(db).create(
        product_id=pid, business_profile_id=user.business_profile_id, **data
    )


@router.get("/products/{pid}/quantities", response_model=list[ProductQuantityOut])
async def stock_history(pid: int, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    product = await ProductRepository(db).get(pid)
    if not product or product.business_profile_id != user.business_profile_id:
        raise NotFoundError("Product not found")
    return await ProductQuantityRepository(db).history(pid)


@router.post("/products/{pid}/quantities", response_model=ProductQuantityOut, status_code=201)
@retry_on_deadlock()
async def adjust_stock(
    pid: int,
    payload: StockAdjustment,
    idempotency_key: str | None = Header(default=None, alias="Idempotency-Key"),
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(BM),
):
    idem = await begin_idempotent_request(
        db,
        idempotency_key,
        f"POS:POST:/products/{pid}/quantities",
        {"product_id": pid, **payload.model_dump()},
    )
    if idem.replay_body is not None:
        return idem.replay_body
    product = await ProductRepository(db).get_for_update(pid)
    if not product or product.business_profile_id != user.business_profile_id:
        raise NotFoundError("Product not found")
    idempotency_key = f"POS:ADJUSTMENT:{user.id}:{product.id}:{payload.transaction_type}:{payload.quantity_change}:{payload.note or ''}"
    existing_ledger = await db.execute(
        select(InventoryLedger).where(InventoryLedger.idempotency_key == idempotency_key)
    )
    if existing_ledger.scalar_one_or_none():
        logger.info(
            "event=inventory_idempotent_replay product_id=%s idempotency_key=%s source=POS reference_id=%s",
            product.id,
            idempotency_key,
            product.id,
        )
        raise ConflictError("Duplicate stock adjustment")
    if payload.transaction_type == "purchase" or payload.quantity_change > 0:
        product.qty_bought = Decimal(str(product.qty_bought)) + payload.quantity_change
    old_stock = Decimal(str(product.stock_cached or 0))
    movement_result = InventoryMovementService().apply(
        InventoryMovement(
            movement_type=(
                InventoryMovementType.PURCHASE
                if payload.quantity_change > 0
                else InventoryMovementType.ADJUSTMENT
            ),
            product_id=product.id,
            quantity=payload.quantity_change,
            business_profile_id=user.business_profile_id,
            outlet_id=user.outlet_id,
            reason=payload.transaction_type,
            reference_type="adjustment",
            reference_id=str(product.id),
            idempotency_key=idempotency_key,
            user_id=str(user.id),
            source="POS",
        ),
        current_stock=old_stock,
    )
    product.stock_cached = movement_result.new_stock
    if Decimal(str(product.stock_cached)) < 0:
        raise ConflictError("Insufficient stock for this adjustment")
    db.add(
        InventoryLedger(
            product_id=product.id,
            business_profile_id=movement_result.ledger_entry.business_profile_id,
            outlet_id=movement_result.ledger_entry.outlet_id,
            type=movement_result.ledger_entry.ledger_type,
            quantity=movement_result.ledger_entry.quantity_delta,
            old_stock=movement_result.ledger_entry.old_stock,
            new_stock=movement_result.ledger_entry.new_stock,
            idempotency_key=movement_result.ledger_entry.idempotency_key,
            user_id=movement_result.ledger_entry.user_id,
            source=movement_result.ledger_entry.source,
            reason=movement_result.ledger_entry.reason,
            reference_type=movement_result.ledger_entry.reference_type,
            reference_id=movement_result.ledger_entry.reference_id,
        )
    )
    logger.info(
        "event=inventory_update product_id=%s change=%s new_stock=%s source=POS reference_type=adjustment reference_id=%s idempotency_key=%s",
        product.id,
        payload.quantity_change,
        product.stock_cached,
        product.id,
        idempotency_key,
    )
    quantity_record = await ProductQuantityRepository(db).create(
        product_id=pid,
        business_profile_id=user.business_profile_id,
        transaction_type=payload.transaction_type,
        quantity_change=payload.quantity_change,
        remaining_quantity=product.stock_cached,
        note=payload.note,
    )
    response = ProductQuantityOut.model_validate(quantity_record).model_dump(mode="json")
    complete_idempotent_request(idem, response, status.HTTP_201_CREATED)
    return response


# ------------------------------ Inventory ------------------------------
@router.get("/inventory/low-stock", response_model=list[ProductOut])
async def low_stock(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    return await ProductRepository(db).low_stock(user.business_profile_id)


@router.get("/inventory/out-of-stock", response_model=list[ProductOut])
async def out_of_stock(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    return await ProductRepository(db).out_of_stock(user.business_profile_id)


@router.get("/inventory/damaged")
async def damaged_inventory(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(BM_SM)):
    rows = await DamagedInventoryRepository(db).list(
        limit=200,
        business_profile_id=user.business_profile_id,
    )
    return [
        {
            "id": r.id,
            "product_id": r.product_id,
            "quantity": r.quantity,
            "damage_type": r.damage_type,
            "disposition": r.disposition,
            "return_id": r.return_id,
        }
        for r in rows
    ]


# ------------------------------ Customers ------------------------------
@router.get("/customers", response_model=list[CustomerOut])
async def list_customers(db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    return await CustomerRepository(db).list(limit=200, outlet_id=user.outlet_id)


@router.get("/customers/phone/{phone}", response_model=CustomerOut)
async def customer_by_phone(phone: str, db: AsyncSession = Depends(get_db), user: CurrentUser = Depends(get_current_user)):
    obj = await CustomerRepository(db).get_by_phone(user.outlet_id, phone)
    if not obj:
        raise NotFoundError("Customer not found")
    return obj


@router.post("/customers", response_model=CustomerOut, status_code=201)
async def create_customer(
    payload: CustomerCreate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(BM_SM_SP),
):
    repo = CustomerRepository(db)
    if payload.phone and await repo.get_by_phone(user.outlet_id, payload.phone):
        raise ConflictError("Customer with this phone already exists")
    return await repo.create(outlet_id=user.outlet_id, **payload.model_dump())


@router.put("/customers/{cid}", response_model=CustomerOut)
async def update_customer(
    cid: int,
    payload: CustomerUpdate,
    db: AsyncSession = Depends(get_db),
    user: CurrentUser = Depends(BM_SM_SP),
):
    repo = CustomerRepository(db)
    obj = await repo.get(cid)
    if not obj or obj.outlet_id != user.outlet_id:
        raise NotFoundError("Customer not found")
    return await repo.update(obj, **payload.model_dump(exclude_unset=True))
