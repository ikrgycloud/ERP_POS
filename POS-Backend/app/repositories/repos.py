"""Entity-specific repositories with custom query methods."""
import json
import re
from datetime import date, datetime
from decimal import Decimal
from typing import Optional, Sequence
from urllib.parse import urlparse

from sqlalchemy import and_, case, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.models.catalog import (
    Category,
    DamagedInventory,
    Product,
    ProductDiscount,
    ProductQuantity,
    Supplier,
)
from app.models.org import BusinessProfile, Outlet, Staff
from app.models.sales import (
    AuditLog,
    Customer,
    Invoice,
    InvoiceItem,
    Order,
    OrderItem,
    Payment,
    Return,
    ReturnItem,
    Waybill,
)
from app.repositories.base import BaseRepository


class StaffRepository(BaseRepository[Staff]):
    def __init__(self, db: AsyncSession):
        super().__init__(Staff, db)

    async def get_by_code(self, employee_code: str) -> Optional[Staff]:
        return await self.get_by(employee_code=employee_code)

    async def get_by_email(self, email: str) -> Optional[Staff]:
        stmt = select(Staff).where(func.lower(Staff.email) == email.lower()).limit(1)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_subordinates(self, manager_id: int) -> Sequence[Staff]:
        stmt = select(Staff).where(Staff.manager_id == manager_id).order_by(Staff.full_name)
        return (await self.db.execute(stmt)).scalars().all()

    async def list_by_role(
        self, business_profile_id: int, role: str
    ) -> Sequence[Staff]:
        stmt = select(Staff).where(
            and_(
                Staff.business_profile_id == business_profile_id,
                Staff.role == role,
            )
        )
        return (await self.db.execute(stmt)).scalars().all()


class BusinessProfileRepository(BaseRepository[BusinessProfile]):
    def __init__(self, db: AsyncSession):
        super().__init__(BusinessProfile, db)


class OutletRepository(BaseRepository[Outlet]):
    def __init__(self, db: AsyncSession):
        super().__init__(Outlet, db)


class CategoryRepository(BaseRepository[Category]):
    def __init__(self, db: AsyncSession):
        super().__init__(Category, db)


class SupplierRepository(BaseRepository[Supplier]):
    def __init__(self, db: AsyncSession):
        super().__init__(Supplier, db)


class ProductRepository(BaseRepository[Product]):
    def __init__(self, db: AsyncSession):
        super().__init__(Product, db)

    async def get_by_barcode(
        self,
        barcode: str,
        business_profile_id: int | None = None,
    ) -> Optional[Product]:
        code = (barcode or "").strip()
        if not code:
            return None
        stmt = select(Product).where(Product.barcode == code)
        if business_profile_id is not None:
            stmt = stmt.where(Product.business_profile_id == business_profile_id)
        return (await self.db.execute(stmt.limit(1))).scalar_one_or_none()

    async def get_by_scan_code(
        self,
        scan_code: str,
        business_profile_id: int | None = None,
    ) -> Optional[Product]:
        code = (scan_code or "").strip()
        if not code:
            return None

        stmt = select(Product).where(
            or_(Product.barcode == code, Product.sku == code)
        )
        if business_profile_id is not None:
            stmt = stmt.where(Product.business_profile_id == business_profile_id)
        product = (await self.db.execute(stmt.limit(1))).scalar_one_or_none()
        if product:
            return product

        product_id = self._product_id_from_scan(code)
        if product_id is not None:
            product = await self.get(product_id)
            if product and (
                business_profile_id is None
                or product.business_profile_id == business_profile_id
            ):
                return product
        return None

    @staticmethod
    def _product_id_from_scan(scan_code: str) -> int | None:
        if scan_code.isdigit():
            return int(scan_code)

        try:
            payload = json.loads(scan_code)
        except json.JSONDecodeError:
            payload = None
        if isinstance(payload, dict):
            value = payload.get("productId") or payload.get("product_id") or payload.get("id")
            if str(value or "").isdigit():
                return int(value)

        parsed = urlparse(scan_code)
        path = parsed.path if parsed.scheme else scan_code
        match = re.search(r"/products/(\d+)(?:/(?:scan|pos|qr))?/?$", path)
        if match:
            return int(match.group(1))
        return None

    async def get_by_sku(
        self,
        sku: str,
        business_profile_id: int | None = None,
    ) -> Optional[Product]:
        filters = {"sku": sku}
        if business_profile_id is not None:
            filters["business_profile_id"] = business_profile_id
        return await self.get_by(**filters)

    async def get_for_update(self, product_id: int) -> Optional[Product]:
        stmt = select(Product).where(Product.id == product_id).with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_many(self, product_ids: Sequence[int]) -> dict[int, Product]:
        ids = list({int(pid) for pid in product_ids})
        if not ids:
            return {}
        stmt = select(Product).where(Product.id.in_(ids))
        products = (await self.db.execute(stmt)).scalars().all()
        return {product.id: product for product in products}

    async def get_many_for_update(self, product_ids: Sequence[int]) -> dict[int, Product]:
        ids = sorted({int(pid) for pid in product_ids})
        if not ids:
            return {}
        stmt = select(Product).where(Product.id.in_(ids)).order_by(Product.id).with_for_update()
        products = (await self.db.execute(stmt)).scalars().all()
        return {product.id: product for product in products}

    async def stock_on_hand(self, product_id: int, outlet_id: int | None = None) -> Decimal:
        stmt = select(Product.stock_cached).where(Product.id == product_id)
        value = (await self.db.execute(stmt)).scalar_one()
        return Decimal(str(value or 0))

    async def search(
        self,
        q: Optional[str],
        skip: int,
        limit: int,
        business_profile_id: int | None = None,
        cursor: int | None = None,
    ) -> Sequence[Product]:
        stmt = select(Product)
        if business_profile_id is not None:
            stmt = stmt.where(Product.business_profile_id == business_profile_id)
        if q:
            like = f"%{q}%"
            stmt = stmt.where(
                or_(
                    Product.sku == q,
                    Product.barcode == q,
                    Product.name.ilike(like),
                )
            )
        if cursor is not None:
            stmt = stmt.where(Product.id < cursor).order_by(Product.id.desc()).limit(limit)
            return (await self.db.execute(stmt)).scalars().all()
        stmt = stmt.order_by(Product.name).offset(skip).limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def low_stock(self, business_profile_id: int | None = None) -> Sequence[Product]:
        stmt = select(Product).where(Product.stock_cached <= Product.reorder_level)
        if business_profile_id is not None:
            stmt = stmt.where(Product.business_profile_id == business_profile_id)
        return (await self.db.execute(stmt)).scalars().all()

    async def out_of_stock(self, business_profile_id: int | None = None) -> Sequence[Product]:
        stmt = select(Product).where(Product.stock_cached <= 0)
        if business_profile_id is not None:
            stmt = stmt.where(Product.business_profile_id == business_profile_id)
        return (await self.db.execute(stmt)).scalars().all()


class ProductQuantityRepository(BaseRepository[ProductQuantity]):
    def __init__(self, db: AsyncSession):
        super().__init__(ProductQuantity, db)

    async def history(self, product_id: int) -> Sequence[ProductQuantity]:
        stmt = (
            select(ProductQuantity)
            .where(ProductQuantity.product_id == product_id)
            .order_by(ProductQuantity.id.desc())
        )
        return (await self.db.execute(stmt)).scalars().all()


class ProductDiscountRepository(BaseRepository[ProductDiscount]):
    def __init__(self, db: AsyncSession):
        super().__init__(ProductDiscount, db)

    @staticmethod
    def _discount_savings(discount: ProductDiscount, qty: Decimal, unit_price: Decimal) -> Decimal:
        gross = qty * unit_price
        if gross <= 0:
            return Decimal("0")
        value = Decimal(str(discount.discount_value or 0))
        if (discount.discount_type or "").strip().lower() == "percentage":
            return max(Decimal("0"), (gross * value) / Decimal("100"))
        return min(gross, qty * value)

    @staticmethod
    def _is_eligible(discount: ProductDiscount, qty: Decimal, on: date) -> bool:
        if not discount.is_active:
            return False
        if Decimal(str(discount.min_quantity)) > qty:
            return False
        if discount.start_date is not None and discount.start_date > on:
            return False
        if discount.end_date is not None and discount.end_date < on:
            return False
        return True

    async def active_for_product(
        self, product_id: int, qty: Decimal | float, on: date, unit_price: Decimal | None = None
    ) -> Optional[ProductDiscount]:
        stmt = (
            select(ProductDiscount)
            .where(
                ProductDiscount.product_id == product_id,
                ProductDiscount.is_active.is_(True),
            )
            .order_by(ProductDiscount.start_date.desc(), ProductDiscount.created_at.desc(), ProductDiscount.id.desc())
        )
        normalized_qty = Decimal(str(qty))
        price = Decimal(str(unit_price or 0))
        eligible = [
            discount
            for discount in (await self.db.execute(stmt)).scalars().all()
            if self._is_eligible(discount, normalized_qty, on)
        ]
        if not eligible:
            return None
        if price <= 0:
            return eligible[0]
        return sorted(
            eligible,
            key=lambda discount: (
                self._discount_savings(discount, normalized_qty, price),
                discount.start_date or date.min,
                discount.created_at or datetime.min,
                discount.id or 0,
            ),
            reverse=True,
        )[0]

    async def active_for_products(
        self,
        quantities_by_product: dict[int, Decimal],
        on: date,
        unit_prices_by_product: dict[int, Decimal] | None = None,
    ) -> dict[int, ProductDiscount]:
        if not quantities_by_product:
            return {}
        stmt = (
            select(ProductDiscount)
            .where(
                ProductDiscount.product_id.in_(list(quantities_by_product.keys())),
                ProductDiscount.is_active.is_(True),
            )
            .order_by(ProductDiscount.product_id, ProductDiscount.start_date.desc(), ProductDiscount.created_at.desc(), ProductDiscount.id.desc())
        )
        eligible_by_product: dict[int, list[ProductDiscount]] = {}
        for discount in (await self.db.execute(stmt)).scalars().all():
            product_id = discount.product_id
            qty = quantities_by_product.get(product_id, Decimal("0"))
            if self._is_eligible(discount, qty, on):
                eligible_by_product.setdefault(product_id, []).append(discount)
        selected: dict[int, ProductDiscount] = {}
        unit_prices_by_product = unit_prices_by_product or {}
        for product_id, discounts in eligible_by_product.items():
            price = Decimal(str(unit_prices_by_product.get(product_id, 0)))
            if price <= 0:
                selected[product_id] = discounts[0]
                continue
            selected[product_id] = sorted(
                discounts,
                key=lambda discount: (
                    self._discount_savings(discount, quantities_by_product[product_id], price),
                    discount.start_date or date.min,
                    discount.created_at or datetime.min,
                    discount.id or 0,
                ),
                reverse=True,
            )[0]
        return selected


class DamagedInventoryRepository(BaseRepository[DamagedInventory]):
    def __init__(self, db: AsyncSession):
        super().__init__(DamagedInventory, db)


class CustomerRepository(BaseRepository[Customer]):
    def __init__(self, db: AsyncSession):
        super().__init__(Customer, db)

    async def get_by_phone(self, outlet_id: int, phone: str) -> Optional[Customer]:
        return await self.get_by(outlet_id=outlet_id, phone=phone)


class OrderRepository(BaseRepository[Order]):
    def __init__(self, db: AsyncSession):
        super().__init__(Order, db)

    async def active_draft_for_staff(
        self,
        business_profile_id: int,
        outlet_id: int,
        staff_id: int,
        for_update: bool = False,
        include_items: bool = False,
    ) -> Optional[Order]:
        stmt = (
            select(Order)
            .where(
                Order.business_profile_id == business_profile_id,
                Order.outlet_id == outlet_id,
                Order.staff_id == staff_id,
                Order.status == "Draft",
            )
            .order_by(Order.updated_at.desc(), Order.id.desc())
            .limit(1)
        )
        if include_items:
            stmt = stmt.options(selectinload(Order.items))
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def expired_drafts(
        self,
        cutoff: datetime,
        limit: int,
        business_profile_id: int | None = None,
        outlet_id: int | None = None,
        staff_id: int | None = None,
        for_update: bool = False,
    ) -> Sequence[Order]:
        stmt = (
            select(Order)
            .where(
                Order.status == "Draft",
                Order.expires_at.is_not(None),
                Order.expires_at <= cutoff,
            )
            .order_by(Order.expires_at, Order.id)
            .limit(limit)
        )
        if business_profile_id is not None:
            stmt = stmt.where(Order.business_profile_id == business_profile_id)
        if outlet_id is not None:
            stmt = stmt.where(Order.outlet_id == outlet_id)
        if staff_id is not None:
            stmt = stmt.where(Order.staff_id == staff_id)
        if for_update:
            stmt = stmt.with_for_update(skip_locked=True)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_with_items(self, order_id: int, for_update: bool = False) -> Optional[Order]:
        stmt = select(Order).options(selectinload(Order.items)).where(Order.id == order_id)
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()


class OrderItemRepository(BaseRepository[OrderItem]):
    def __init__(self, db: AsyncSession):
        super().__init__(OrderItem, db)

    async def list_for_order(self, order_id: int) -> Sequence[OrderItem]:
        stmt = select(OrderItem).where(OrderItem.order_id == order_id)
        return (await self.db.execute(stmt)).scalars().all()

    async def get_for_order_product(
        self,
        order_id: int,
        product_id: int,
        for_update: bool = False,
    ) -> Optional[OrderItem]:
        stmt = (
            select(OrderItem)
            .where(OrderItem.order_id == order_id, OrderItem.product_id == product_id)
            .order_by(OrderItem.id)
            .limit(1)
        )
        if for_update:
            stmt = stmt.with_for_update()
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def quantity_for_product(
        self,
        order_id: int,
        product_id: int,
        exclude_item_id: int | None = None,
    ) -> Decimal:
        stmt = select(func.coalesce(func.sum(OrderItem.quantity), 0)).where(
            OrderItem.order_id == order_id,
            OrderItem.product_id == product_id,
        )
        if exclude_item_id is not None:
            stmt = stmt.where(OrderItem.id != exclude_item_id)
        value = (await self.db.execute(stmt)).scalar_one()
        return Decimal(str(value or 0))


class InvoiceRepository(BaseRepository[Invoice]):
    def __init__(self, db: AsyncSession):
        super().__init__(Invoice, db)

    async def get_by_number(self, invoice_number: str) -> Optional[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
            .where(Invoice.invoice_number == invoice_number)
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_with_items(self, invoice_id: int) -> Optional[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
            .where(Invoice.id == invoice_id)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def get_visible(
        self,
        invoice_id: int,
        business_profile_id: int,
        outlet_id: int | None = None,
    ) -> Optional[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
            .where(
                Invoice.id == invoice_id,
                Invoice.business_profile_id == business_profile_id,
            )
        )
        if outlet_id is not None:
            stmt = stmt.where(Invoice.outlet_id == outlet_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def latest_sale_containing_product(
        self,
        product_id: int,
        outlet_id: int | None,
        business_profile_id: int | None = None,
    ) -> Optional[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
            .join(Order, Order.id == Invoice.order_id)
            .join(OrderItem, OrderItem.order_id == Order.id)
            .where(
                Invoice.is_reverse.is_(False),
                OrderItem.product_id == product_id,
            )
            .order_by(Invoice.id.desc())
            .limit(1)
        )
        if outlet_id is not None:
            stmt = stmt.where(Invoice.outlet_id == outlet_id)
        if business_profile_id is not None:
            stmt = stmt.where(Invoice.business_profile_id == business_profile_id)
        return (await self.db.execute(stmt)).scalar_one_or_none()

    async def list_for_staff(
        self, staff_id: int, skip: int, limit: int, cursor: int | None = None
    ) -> Sequence[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
            .where(Invoice.staff_id == staff_id, Invoice.is_reverse.is_(False))
        )
        if cursor is not None:
            stmt = stmt.where(Invoice.id < cursor).order_by(Invoice.id.desc()).limit(limit)
            return (await self.db.execute(stmt)).scalars().all()
        stmt = stmt.order_by(Invoice.id.desc()).offset(skip).limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def list_recent(self, skip: int, limit: int, cursor: int | None = None) -> Sequence[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
        )
        if cursor is not None:
            stmt = stmt.where(Invoice.id < cursor).order_by(Invoice.id.desc()).limit(limit)
            return (await self.db.execute(stmt)).scalars().all()
        stmt = stmt.order_by(Invoice.id.desc()).offset(skip).limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def list_for_business(
        self,
        business_profile_id: int,
        skip: int,
        limit: int,
        cursor: int | None = None,
    ) -> Sequence[Invoice]:
        stmt = (
            select(Invoice)
            .options(selectinload(Invoice.items))
            .where(Invoice.business_profile_id == business_profile_id)
        )
        if cursor is not None:
            stmt = stmt.where(Invoice.id < cursor).order_by(Invoice.id.desc()).limit(limit)
            return (await self.db.execute(stmt)).scalars().all()
        stmt = stmt.order_by(Invoice.id.desc()).offset(skip).limit(limit)
        return (await self.db.execute(stmt)).scalars().all()

    async def revenue_by_staff(self, staff_id: int) -> float:
        stmt = select(
            func.coalesce(
                func.sum(
                    Invoice.taxable_value + Invoice.cgst + Invoice.sgst + Invoice.igst
                ),
                0,
            )
        ).where(Invoice.staff_id == staff_id, Invoice.is_reverse.is_(False))
        return float((await self.db.execute(stmt)).scalar_one())

    async def count_for_staff(self, staff_id: int) -> int:
        return await self.count(staff_id=staff_id, is_reverse=False)


class InvoiceItemRepository(BaseRepository[InvoiceItem]):
    def __init__(self, db: AsyncSession):
        super().__init__(InvoiceItem, db)


class PaymentRepository(BaseRepository[Payment]):
    def __init__(self, db: AsyncSession):
        super().__init__(Payment, db)

    async def summary_by_method(
        self,
        business_profile_id: int | None = None,
        start_date: date | None = None,
        end_date: date | None = None,
    ) -> list[dict]:
        stmt = (
            select(
                Payment.method,
                func.sum(case((Payment.direction == "out", -Payment.amount), else_=Payment.amount)),
            )
            .group_by(Payment.method)
        )
        if business_profile_id is not None:
            stmt = stmt.where(Payment.business_profile_id == business_profile_id)
        if start_date is not None:
            stmt = stmt.where(Payment.created_at >= start_date)
        if end_date is not None:
            stmt = stmt.where(Payment.created_at < end_date + date.resolution)
        rows = (await self.db.execute(stmt)).all()
        return [{"method": m, "total": float(t)} for m, t in rows]


class ReturnRepository(BaseRepository[Return]):
    def __init__(self, db: AsyncSession):
        super().__init__(Return, db)

    async def get(self, id_: int) -> Optional[Return]:
        stmt = (
            select(Return)
            .options(selectinload(Return.items), selectinload(Return.evidence))
            .where(Return.id == id_)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def get_by(self, **filters) -> Optional[Return]:
        stmt = (
            select(Return)
            .options(selectinload(Return.items), selectinload(Return.evidence))
            .filter_by(**filters)
            .limit(1)
        )
        result = await self.db.execute(stmt)
        return result.scalar_one_or_none()

    async def list(
        self,
        *,
        skip: int = 0,
        limit: int = 50,
        order_by=None,
        staff_ids: Sequence[int] | None = None,
        **filters,
    ) -> Sequence[Return]:
        stmt = (
            select(Return)
            .options(selectinload(Return.items), selectinload(Return.evidence))
            .filter_by(**filters)
        )
        if staff_ids is not None:
            if not staff_ids:
                return []
            stmt = stmt.where(Return.staff_id.in_(staff_ids))
        if order_by is not None:
            stmt = stmt.order_by(order_by)
        else:
            stmt = stmt.order_by(Return.id.desc())
        result = await self.db.execute(stmt.offset(skip).limit(limit))
        return result.scalars().all()

    async def get_by_number(self, return_number: str) -> Optional[Return]:
        return await self.get_by(return_number=return_number)


class ReturnItemRepository(BaseRepository[ReturnItem]):
    def __init__(self, db: AsyncSession):
        super().__init__(ReturnItem, db)


class WaybillRepository(BaseRepository[Waybill]):
    def __init__(self, db: AsyncSession):
        super().__init__(Waybill, db)


class AuditLogRepository(BaseRepository[AuditLog]):
    def __init__(self, db: AsyncSession):
        super().__init__(AuditLog, db)
