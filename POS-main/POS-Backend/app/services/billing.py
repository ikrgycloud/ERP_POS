"""Billing service — cart lifecycle and invoice generation.

The POS cart is modelled as a Draft order. Checkout converts it into an
immutable invoice, records payment, and applies inventory + revenue.
"""
import asyncio
import logging
import time
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal

from sqlalchemy import select
from sqlalchemy.exc import DBAPIError, IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.core.config import settings
from app.core.exceptions import BusinessRuleError, ConflictError, NotFoundError
from app.models.catalog import InventoryLedger, ProductQuantity
from app.models.sales import ApprovalRequest, CashDrawerEvent, Invoice, InvoiceItem, InvoicePayment, Order, Payment, ShiftSession
from app.repositories.repos import (
    CustomerRepository,
    InvoiceRepository,
    OrderItemRepository,
    OrderRepository,
    ProductDiscountRepository,
    ProductQuantityRepository,
    ProductRepository,
)
from app.schemas.transactions import (
    CartLine,
    CartTotals,
    CartView,
    CheckoutPayment,
    CheckoutRequest,
)
from app.services.common import AuditService, NumberService
from app.services.invoice_links import InvoiceLinkService
from app.services.notifications import NotificationService
from app.utils.helpers import discount_pct_for_price, gen_number, line_total, money, split_gst
from shared_domain.inventory import (
    InventoryMovement,
    InventoryMovementService as DomainInventoryMovementService,
    InventoryMovementType,
)
from shared_domain.sales import InvoiceLine, InvoiceService as DomainInvoiceService


logger = logging.getLogger("pos_api.billing")
QTY_SCALE = Decimal("0.001")
CART_STATUS_DRAFT = "Draft"
CART_STATUS_COMPLETED = "Completed"
CART_STATUS_CANCELLED = "Cancelled"
CART_STATUS_EXPIRED = "Expired"
PAYMENT_METHODS = {"cash", "upi", "card", "wallet", "cheque"}


def is_deadlock_error(exc: BaseException) -> bool:
    original = getattr(exc, "orig", exc)
    return (
        getattr(original, "sqlstate", None) == "40P01"
        or getattr(original, "pgcode", None) == "40P01"
        or "deadlock" in str(original).lower()
    )


class BillingService:
    def __init__(self, db: AsyncSession, user: CurrentUser, terminal_id: str | None = None):
        self.db = db
        self.user = user
        self.terminal_id = self._normalize_terminal_id(terminal_id)
        self.orders = OrderRepository(db)
        self.items = OrderItemRepository(db)
        self.products = ProductRepository(db)
        self.discounts = ProductDiscountRepository(db)
        self.invoices = InvoiceRepository(db)
        self.stock = ProductQuantityRepository(db)
        self.customers = CustomerRepository(db)
        self.numbers = NumberService(db)
        self.audit = AuditService(
            db,
            user.business_profile_id,
            staff_id=user.id,
            outlet_id=user.outlet_id,
            terminal_id=self.terminal_id,
        )
        self.notifications = NotificationService(db)
        self.inventory_rules = DomainInventoryMovementService()
        self.invoice_rules = DomainInvoiceService()

    @staticmethod
    def _now() -> datetime:
        return datetime.utcnow()

    @staticmethod
    def _utc_naive(value: datetime) -> datetime:
        if value.tzinfo is None:
            return value
        return value.astimezone(timezone.utc).replace(tzinfo=None)

    def _next_expiry(self) -> datetime:
        return self._now() + timedelta(minutes=settings.CART_DRAFT_EXPIRY_MINUTES)

    def _next_lease_expiry(self) -> datetime:
        return self._now() + timedelta(seconds=settings.CART_LEASE_TIMEOUT_SECONDS)

    @staticmethod
    def _normalize_terminal_id(terminal_id: str | None) -> str:
        value = (terminal_id or "").strip()
        return value[:120] if value else "default"

    def _touch_cart(self, order: Order) -> None:
        order.expires_at = self._next_expiry()

    def _renew_lease(self, order: Order) -> None:
        order.terminal_id = self.terminal_id
        order.lease_expires_at = self._next_lease_expiry()

    def _ensure_cart_lease(self, order: Order) -> None:
        now = self._now()
        if (
            order.terminal_id
            and order.terminal_id != self.terminal_id
            and order.lease_expires_at
            and self._utc_naive(order.lease_expires_at) > now
        ):
            raise ConflictError(
                f"This cart is already active on Terminal {order.terminal_id}",
                code="CART_LEASE_HELD",
                details={
                    "order_id": order.id,
                    "terminal_id": order.terminal_id,
                    "lease_expires_at": (
                        order.lease_expires_at.isoformat() if order.lease_expires_at else None
                    ),
                    "retry_after_seconds": max(
                        1,
                        int(
                            (
                                self._utc_naive(order.lease_expires_at) - now
                            ).total_seconds()
                        ) + 1,
                    ),
                },
            )
        self._renew_lease(order)

    async def _active_shift_id(self) -> int | None:
        stmt = (
            select(ShiftSession.id)
            .where(
                ShiftSession.business_profile_id == self.user.business_profile_id,
                ShiftSession.outlet_id == self.user.outlet_id,
                ShiftSession.staff_id == self.user.id,
                ShiftSession.terminal_id == self.terminal_id,
                ShiftSession.status == "open",
            )
            .order_by(ShiftSession.id.desc())
        )
        return (await self.db.execute(stmt)).scalars().first()

    async def _has_approved_cart_action(self, order_id: int, approval_types: set[str]) -> bool:
        stmt = (
            select(ApprovalRequest.id)
            .where(
                ApprovalRequest.business_profile_id == self.user.business_profile_id,
                ApprovalRequest.outlet_id == self.user.outlet_id,
                ApprovalRequest.order_id == order_id,
                ApprovalRequest.requested_by_staff_id == self.user.id,
                ApprovalRequest.status == "approved",
                ApprovalRequest.approval_type.in_(approval_types),
            )
            .limit(1)
        )
        return (await self.db.execute(stmt)).scalar_one_or_none() is not None

    async def _expire_order_if_needed(self, order: Order) -> bool:
        if (
            order.status == CART_STATUS_DRAFT
            and order.expires_at
            and self._utc_naive(order.expires_at) <= self._now()
        ):
            order.status = CART_STATUS_EXPIRED
            await self.db.flush()
            return True
        return False

    async def expire_abandoned_drafts(
        self,
        *,
        limit: int | None = None,
        business_profile_id: int | None = None,
        outlet_id: int | None = None,
        staff_id: int | None = None,
    ) -> int:
        expired = await self.orders.expired_drafts(
            self._now(),
            limit or settings.CART_CLEANUP_BATCH_SIZE,
            business_profile_id=business_profile_id,
            outlet_id=outlet_id,
            staff_id=staff_id,
            for_update=True,
        )
        for order in expired:
            order.status = CART_STATUS_EXPIRED
        if expired:
            await self.db.flush()
        return len(expired)

    async def _expire_current_user_drafts(self) -> int:
        return await self.expire_abandoned_drafts(
            business_profile_id=self.user.business_profile_id,
            outlet_id=self.user.outlet_id,
            staff_id=self.user.id,
        )

    async def start_cart(self, customer_id: int | None) -> Order:
        await self._expire_current_user_drafts()
        active = await self.orders.active_draft_for_staff(
            self.user.business_profile_id,
            self.user.outlet_id,
            self.user.id,
            for_update=True,
        )
        if active:
            self._ensure_cart_lease(active)
            if customer_id is not None and active.customer_id != customer_id:
                customer = await self._get_customer(customer_id)
                active.customer_id = customer.id
                active.party_name = self._party_name(customer)
            self._touch_cart(active)
            await self.db.flush()
            await self.audit.log(
                "cart_restored",
                "cart",
                active.id,
                {"order": active.order_number, "terminal_id": self.terminal_id},
            )
            return active

        customer = await self._get_customer(customer_id) if customer_id else None
        seq = await self.numbers.next_order_seq()
        try:
            order = await self.orders.create(
                business_profile_id=self.user.business_profile_id,
                order_number=gen_number("ORD", seq),
                type="sale",
                party_type="customer",
                party_name=self._party_name(customer),
                outlet_id=self.user.outlet_id,
                customer_id=customer_id,
                staff_id=self.user.id,
                status=CART_STATUS_DRAFT,
                date=date.today(),
                expires_at=self._next_expiry(),
                terminal_id=self.terminal_id,
                lease_expires_at=self._next_lease_expiry(),
            )
        except IntegrityError:
            await self.db.rollback()
            active = await self.orders.active_draft_for_staff(
                self.user.business_profile_id,
                self.user.outlet_id,
                self.user.id,
                for_update=True,
            )
            if not active:
                raise
            self._ensure_cart_lease(active)
            self._touch_cart(active)
            await self.db.flush()
            return active
        await self.audit.log(
            "cart_started",
            "cart",
            order.id,
            {"order": order.order_number, "customer_id": customer_id},
        )
        return order

    async def active_cart(self, inter_state: bool = False) -> CartView | None:
        order = await self.orders.active_draft_for_staff(
            self.user.business_profile_id,
            self.user.outlet_id,
            self.user.id,
            include_items=True,
        )
        if not order:
            return None
        if await self._expire_order_if_needed(order):
            return None
        self._ensure_cart_lease(order)
        await self.db.flush()
        return await self._cart_view_for_order(order, inter_state)

    async def renew_cart_lease(self, order_id: int) -> datetime:
        """Renew a cart lease without creating a cart-restored audit event."""
        order = await self._get_draft(order_id)
        await self.db.flush()
        return order.lease_expires_at

    async def attach_customer(self, order_id: int, customer_id: int | None) -> None:
        order = await self._get_draft(order_id)
        customer = await self._get_customer(customer_id) if customer_id else None
        order.customer_id = customer.id if customer else None
        order.party_name = self._party_name(customer)
        self._touch_cart(order)
        await self.db.flush()
        await self.audit.log(
            "cart_customer_updated",
            "cart",
            order.id,
            {"order": order.order_number, "customer_id": customer_id},
        )

    async def cancel_cart(self, order_id: int, reason: str = "cancel") -> Order:
        order = await self._get_draft(order_id)
        order.status = CART_STATUS_CANCELLED
        order.expires_at = None
        order.lease_expires_at = None
        await self.db.flush()
        await self.audit.log(reason, "cart", order.id, {"order": order.order_number})
        return order

    async def void_cart(self, order_id: int) -> Order:
        order = await self.orders.get_with_items(order_id)
        if order and order.items and not await self._has_approved_cart_action(
            order_id,
            {"void", "supervisor_override", "manager_approval"},
        ):
            raise BusinessRuleError("Manager approval is required to void a non-empty cart", code="APPROVAL_REQUIRED")
        return await self.cancel_cart(order_id, reason="void")

    async def _get_customer(self, customer_id: int):
        customer = await self.customers.get(customer_id)
        if not customer or customer.outlet_id != self.user.outlet_id:
            raise NotFoundError("Customer not found")
        return customer

    @staticmethod
    def _party_name(customer) -> str:
        if not customer:
            return "Walk-in Customer"
        return customer.name or customer.phone or "Customer"

    @staticmethod
    def _discount_line_details(discount, unit_price: Decimal) -> dict:
        if not discount:
            return {
                "discount_pct": Decimal("0"),
                "discount_type": None,
                "discount_value": None,
                "discount_label": None,
            }
        discount_type = (discount.discount_type or "").strip().lower()
        discount_value = Decimal(str(discount.discount_value or 0))
        discount_pct = discount_pct_for_price(discount_type, discount_value, unit_price)
        if discount_pct <= 0:
            return {
                "discount_pct": Decimal("0"),
                "discount_type": None,
                "discount_value": None,
                "discount_label": None,
            }
        label = f"{discount_pct}% off" if discount_type == "percentage" else f"Rs {discount_value} off"
        return {
            "discount_pct": discount_pct,
            "discount_type": discount_type,
            "discount_value": discount_value,
            "discount_label": label,
        }

    async def _discount_line_for_product(self, product_id: int, qty: Decimal, unit_price: Decimal) -> dict:
        discount = await self.discounts.active_for_product(product_id, qty, date.today(), unit_price)
        return self._discount_line_details(discount, unit_price)

    async def _ensure_stock_available(
        self,
        product,
        requested_quantity: Decimal,
        *,
        order_id: int,
        scan_code: str | None = None,
    ) -> None:
        current_stock = await self.products.stock_on_hand(product.id, self.user.outlet_id)
        if current_stock >= requested_quantity:
            return
        logger.warning(
            "event=pos_insufficient_stock order_id=%s product_id=%s business_profile_id=%s outlet_id=%s staff_id=%s scan_code=%s current_stock=%s requested_quantity=%s",
            order_id,
            product.id,
            product.business_profile_id,
            self.user.outlet_id,
            self.user.id,
            scan_code,
            current_stock,
            requested_quantity,
        )
        raise ConflictError("Insufficient stock for this product", code="INSUFFICIENT_STOCK")

    async def scan_add(self, order_id: int, barcode: str, qty: Decimal) -> CartLine:
        scan_code = (barcode or "").strip()
        logger.info(
            "event=pos_scan_started order_id=%s business_profile_id=%s outlet_id=%s staff_id=%s scan_code=%s quantity=%s",
            order_id,
            self.user.business_profile_id,
            self.user.outlet_id,
            self.user.id,
            scan_code,
            qty,
        )
        order = await self._get_draft(order_id)
        product = await self.products.get_by_scan_code(
            scan_code,
            business_profile_id=None if settings.POS_GLOBAL_PRODUCT_CATALOG else self.user.business_profile_id,
        )
        if not product or not product.is_active:
            logger.warning(
                "event=pos_scan_product_not_found order_id=%s business_profile_id=%s outlet_id=%s staff_id=%s scan_code=%s",
                order_id,
                self.user.business_profile_id,
                self.user.outlet_id,
                self.user.id,
                scan_code,
            )
            raise NotFoundError(f"No product for barcode {scan_code}")
        item = await self.items.get_for_order_product(order.id, product.id, for_update=True)
        existing_quantity = Decimal(str(item.quantity)) if item else Decimal("0")
        next_quantity = existing_quantity + qty
        await self._ensure_stock_available(
            product,
            next_quantity,
            order_id=order_id,
            scan_code=scan_code,
        )
        next_quantity = next_quantity.quantize(QTY_SCALE)
        discount_details = await self._discount_line_for_product(product.id, next_quantity, Decimal(str(product.sell_price)))
        if item:
            item.quantity = next_quantity
            self._touch_cart(order)
            await self.db.flush()
        else:
            item = await self.items.create(
                order_id=order.id,
                product_id=product.id,
                quantity=qty.quantize(QTY_SCALE),
                rate=product.sell_price,
                gst_rate=product.gst_rate,
            )
            self._touch_cart(order)
            await self.db.flush()
        logger.info(
            "event=pos_scan_added order_id=%s order_item_id=%s product_id=%s business_profile_id=%s outlet_id=%s staff_id=%s scan_code=%s quantity=%s",
            order_id,
            item.id,
            product.id,
            product.business_profile_id,
            self.user.outlet_id,
            self.user.id,
            scan_code,
            qty,
        )
        await self.audit.log(
            "cart_scan",
            "cart",
            order.id,
            {
                "order": order.order_number,
                "order_item_id": item.id,
                "product_id": product.id,
                "barcode": scan_code,
                "quantity": str(qty),
            },
        )
        return CartLine(
            order_item_id=item.id,
            product_id=product.id,
            product_name=product.name,
            quantity=next_quantity,
            rate=Decimal(str(product.sell_price)),
            discount_pct=discount_details["discount_pct"],
            discount_type=discount_details["discount_type"],
            discount_value=discount_details["discount_value"],
            discount_label=discount_details["discount_label"],
            gst_rate=Decimal(str(product.gst_rate)),
            line_total=line_total(product.sell_price, next_quantity, discount_details["discount_pct"]),
        )

    async def update_line(
        self, order_id: int, item_id: int, product_id: int | None, qty: Decimal | None
    ) -> CartView:
        order = await self._get_draft(order_id)
        item = await self.items.get(item_id)
        if not item or item.order_id != order_id:
            raise NotFoundError("Cart line not found")
        product = None
        if product_id is not None:
            product = await self.products.get(product_id)
            if not product or (
                not settings.POS_GLOBAL_PRODUCT_CATALOG
                and product.business_profile_id != self.user.business_profile_id
            ):
                raise NotFoundError("Product not found")
            item.product_id = product.id
            item.rate = product.sell_price
            item.gst_rate = product.gst_rate
        if qty is not None:
            if qty <= 0:
                raise BusinessRuleError("Quantity must be positive")
            product = product or await self.products.get(item.product_id)
            if not product:
                raise NotFoundError("Product not found")
            other_quantity = await self.items.quantity_for_product(
                order_id,
                product.id,
                exclude_item_id=item.id,
            )
            await self._ensure_stock_available(
                product,
                other_quantity + qty,
                order_id=order_id,
            )
            item.quantity = qty.quantize(QTY_SCALE)
        self._touch_cart(order)
        await self.db.flush()
        await self.audit.log(
            "cart_line_updated",
            "cart",
            order.id,
            {
                "order": order.order_number,
                "order_item_id": item.id,
                "product_id": item.product_id,
                "quantity": str(qty) if qty is not None else None,
            },
        )
        return await self.view(order_id)

    async def remove_line(self, order_id: int, item_id: int) -> CartView:
        order = await self._get_draft(order_id)
        item = await self.items.get(item_id)
        if not item or item.order_id != order_id:
            raise NotFoundError("Cart line not found")
        await self.items.delete(item)
        self._touch_cart(order)
        await self.db.flush()
        self.db.expire(order, ["items"])
        await self.audit.log(
            "cart_line_removed",
            "cart",
            order.id,
            {"order": order.order_number, "order_item_id": item_id, "product_id": item.product_id},
        )
        return await self.view(order_id)

    async def view(self, order_id: int, inter_state: bool = False) -> CartView:
        order = await self.orders.get_with_items(order_id)
        if not order:
            raise NotFoundError("Cart not found")
        if order.staff_id != self.user.id or order.business_profile_id != self.user.business_profile_id:
            raise BusinessRuleError("Cart belongs to another Sales Person")
        if await self._expire_order_if_needed(order):
            raise BusinessRuleError("Cart is no longer editable", code="CART_NOT_EDITABLE")
        if order.status != CART_STATUS_DRAFT:
            raise BusinessRuleError("Cart is no longer editable", code="CART_NOT_EDITABLE")
        self._ensure_cart_lease(order)
        await self.db.flush()
        return await self._cart_view_for_order(order, inter_state)

    async def _cart_view_for_order(self, order: Order, inter_state: bool = False) -> CartView:
        product_ids = [it.product_id for it in order.items]
        products = await self.products.get_many(product_ids)
        quantities_by_product: dict[int, Decimal] = {}
        unit_prices_by_product: dict[int, Decimal] = {}
        for it in order.items:
            quantities_by_product[it.product_id] = quantities_by_product.get(
                it.product_id,
                Decimal("0"),
            ) + Decimal(str(it.quantity))
            unit_prices_by_product[it.product_id] = Decimal(str(it.rate))
        discounts = await self.discounts.active_for_products(
            quantities_by_product,
            date.today(),
            unit_prices_by_product,
        )
        lines: list[CartLine] = []
        for it in order.items:
            discount = discounts.get(it.product_id)
            product = products.get(it.product_id)
            if (
                product
                and not settings.POS_GLOBAL_PRODUCT_CATALOG
                and product.business_profile_id != self.user.business_profile_id
            ):
                product = None
            discount_details = self._discount_line_details(discount, Decimal(str(it.rate)))
            lines.append(
                CartLine(
                    order_item_id=it.id,
                    product_id=it.product_id,
                    product_name=product.name if product else "",
                    quantity=Decimal(str(it.quantity)),
                    rate=Decimal(str(it.rate)),
                    discount_pct=discount_details["discount_pct"],
                    discount_type=discount_details["discount_type"],
                    discount_value=discount_details["discount_value"],
                    discount_label=discount_details["discount_label"],
                    gst_rate=Decimal(str(it.gst_rate)),
                    line_total=line_total(it.rate, it.quantity, discount_details["discount_pct"]),
                )
            )
        totals = self._totals(lines, inter_state)
        return CartView(
            order_id=order.id,
            order_number=order.order_number,
            status=order.status,
            expires_at=order.expires_at,
            terminal_id=order.terminal_id,
            lease_expires_at=order.lease_expires_at,
            lines=lines,
            totals=totals,
        )

    def _totals(self, lines: list[CartLine], inter_state: bool) -> CartTotals:
        invoice_lines = [
            InvoiceLine(
                product_id=ln.product_id,
                product_name=ln.product_name,
                quantity=ln.quantity,
                unit_price=ln.rate,
                discount_pct=ln.discount_pct,
                gst_rate=ln.gst_rate,
                order_item_id=ln.order_item_id,
            )
            for ln in lines
        ]
        totals = self.invoice_rules.totals(invoice_lines, inter_state=inter_state)
        return CartTotals(
            subtotal=totals.subtotal,
            discount=totals.discount,
            taxable_value=totals.taxable_value,
            cgst=totals.cgst,
            sgst=totals.sgst,
            igst=totals.igst,
            grand_total=totals.grand_total,
        )

    @staticmethod
    def _clean_reference(value: str | None) -> str | None:
        text = (value or "").strip()
        return text or None

    def _payment_reference_for_method(self, req: CheckoutRequest, method: str) -> str | None:
        if method == "upi":
            return self._clean_reference(req.upi_reference)
        if method == "card":
            return self._clean_reference(req.card_reference)
        if method == "cheque":
            return self._clean_reference(req.cheque_reference)
        return None

    def _validate_reference(self, method: str, reference: str | None) -> None:
        if method in {"upi", "card", "cheque"} and not reference:
            raise BusinessRuleError(f"{method.upper()} reference is required", code="PAYMENT_REFERENCE_REQUIRED")

    def _build_payments(
        self,
        req: CheckoutRequest,
        grand_total: Decimal,
    ) -> tuple[list[CheckoutPayment], Decimal, Decimal, Decimal, str, str]:
        if req.payments:
            raw_payments = [
                CheckoutPayment(
                    method=payment.method.strip().lower(),
                    amount=money(payment.amount),
                    reference_no=self._clean_reference(payment.reference_no),
                )
                for payment in req.payments
            ]
            payment_method = raw_payments[0].method if len(raw_payments) == 1 else "split"
        else:
            method = (req.payment_method or "").strip().lower()
            amount = money(req.cash_received) if method == "cash" and req.cash_received is not None else grand_total
            raw_payments = [
                CheckoutPayment(
                    method=method,
                    amount=amount,
                    reference_no=self._payment_reference_for_method(req, method),
                )
            ]
            payment_method = method

        if not raw_payments:
            raise BusinessRuleError("At least one payment is required", code="PAYMENT_REQUIRED")

        for payment in raw_payments:
            if payment.method not in PAYMENT_METHODS:
                raise BusinessRuleError("Unsupported payment method", code="UNSUPPORTED_PAYMENT_METHOD")
            self._validate_reference(payment.method, payment.reference_no)

        total_tendered = money(sum((payment.amount for payment in raw_payments), Decimal("0")))
        non_cash_overpay = any(payment.method != "cash" for payment in raw_payments) and total_tendered > grand_total
        if non_cash_overpay:
            raise BusinessRuleError("Only cash payments may exceed invoice total", code="PAYMENT_OVERPAID")
        if total_tendered < grand_total and not req.allow_partial:
            raise BusinessRuleError("Payment amount is less than invoice total", code="PAYMENT_INSUFFICIENT")

        amount_paid = min(total_tendered, grand_total)
        change_due = money(max(total_tendered - grand_total, Decimal("0")))
        balance_due = money(max(grand_total - total_tendered, Decimal("0")))
        invoice_status = "Paid" if balance_due == 0 else "Partially Paid"
        return raw_payments, amount_paid, balance_due, change_due, payment_method, invoice_status

    async def checkout(self, order_id: int, req: CheckoutRequest) -> Invoice:
        for attempt in range(3):
            try:
                return await self._checkout_once(order_id, req)
            except DBAPIError as exc:
                if not is_deadlock_error(exc) or attempt == 2:
                    logger.exception(
                        "event=pos_checkout_failed order_id=%s attempt=%s deadlock=%s",
                        order_id,
                        attempt + 1,
                        is_deadlock_error(exc),
                    )
                    raise
                await self.db.rollback()
                delay = 0.1 * (2 ** attempt)
                logger.warning(
                    "event=pos_checkout_deadlock_retry order_id=%s attempt=%s delay_seconds=%.3f",
                    order_id,
                    attempt + 1,
                    delay,
                )
                await asyncio.sleep(delay)
        raise BusinessRuleError("Checkout failed after retries")

    async def _checkout_once(self, order_id: int, req: CheckoutRequest) -> Invoice:
        checkout_started = time.perf_counter()
        stage_started = checkout_started

        def log_stage(stage: str) -> None:
            nonlocal stage_started
            now = time.perf_counter()
            logger.info(
                "event=pos_checkout_stage order_id=%s stage=%s stage_ms=%.2f total_ms=%.2f",
                order_id,
                stage,
                (now - stage_started) * 1000,
                (now - checkout_started) * 1000,
            )
            stage_started = now

        order = await self.orders.get_with_items(order_id, for_update=True)
        if not order:
            raise NotFoundError("Cart not found")
        if await self._expire_order_if_needed(order):
            raise BusinessRuleError("Cart is no longer editable", code="CART_NOT_EDITABLE")
        if order.status != CART_STATUS_DRAFT:
            raise BusinessRuleError("Cart is no longer editable", code="CART_NOT_EDITABLE")
        if order.staff_id != self.user.id or order.business_profile_id != self.user.business_profile_id:
            raise BusinessRuleError("Cart belongs to another Sales Person")
        if order.outlet_id != self.user.outlet_id:
            raise BusinessRuleError("Cart belongs to another outlet")
        self._ensure_cart_lease(order)
        if not order.items:
            raise BusinessRuleError("Cannot checkout an empty cart")
        shift_id = await self._active_shift_id()
        if not shift_id:
            raise BusinessRuleError(
                "An open shift is required before checkout",
                code="SHIFT_REQUIRED",
            )

        view = await self._cart_view_for_order(order, req.inter_state)
        t = view.totals
        checkout_payments, amount_paid, balance_due, change_due, payment_method, invoice_status = self._build_payments(
            req,
            t.grand_total,
        )
        requested_by_product: dict[int, Decimal] = {}
        for item in order.items:
            requested_by_product[item.product_id] = requested_by_product.get(
                item.product_id,
                Decimal("0"),
            ) + Decimal(str(item.quantity))
        locked_products = await self.products.get_many_for_update(requested_by_product.keys())
        for product_id, requested in sorted(requested_by_product.items()):
            product = locked_products.get(product_id)
            if not product or (
                not settings.POS_GLOBAL_PRODUCT_CATALOG
                and product.business_profile_id != self.user.business_profile_id
            ):
                raise NotFoundError("Product not found")
            if Decimal(str(product.stock_cached or 0)) < requested:
                raise BusinessRuleError(f"Insufficient stock for {product.name}")
            locked_products[product_id] = product
        log_stage("validate_and_lock")

        for attempt in range(3):
            try:
                seq = await self.numbers.next_invoice_seq()
                async with self.db.begin_nested():
                    invoice = await self.invoices.create(
                        business_profile_id=self.user.business_profile_id,
                        invoice_number=gen_number("INV", seq),
                        order_id=order.id,
                        invoice_type="sale",
                        invoice_direction="outlet_to_customer",
                        outlet_id=self.user.outlet_id,
                        customer_id=order.customer_id,
                        staff_id=self.user.id,
                        is_reverse=False,
                        party_type="customer",
                        party_name=order.party_name,
                        date=date.today(),
                        due_date=date.today() + timedelta(days=0),
                        taxable_value=t.taxable_value,
                        cgst=t.cgst,
                        sgst=t.sgst,
                        igst=t.igst,
                        status=invoice_status,
                        payment_method=payment_method,
                        paid_amount=amount_paid,
                        remaining_amount=balance_due,
                        payment_percentage=Decimal("100.00") if t.grand_total else Decimal("0.00"),
                        payment_status=invoice_status,
                        last_payment_date=datetime.now(timezone.utc) if amount_paid > 0 else None,
                    )
                break
            except IntegrityError:
                if attempt == 2:
                    raise BusinessRuleError(
                        "Could not generate a unique invoice number",
                        code="INVOICE_NUMBER_GENERATION_FAILED",
                    )

        # Record one row per tender line.
        payment_rows = [
            Payment(
                business_profile_id=self.user.business_profile_id,
                invoice_id=invoice.id,
                outlet_id=self.user.outlet_id,
                staff_id=self.user.id,
                method=payment.method,
                amount=payment.amount,
                direction="in",
                reference_no=payment.reference_no,
            )
            for payment in checkout_payments
        ]
        self.db.add_all(payment_rows)
        # Mirror the POS tenders into ERP's append-only payment ledger. This
        # makes the shared invoice unambiguously Paid in ERP and prevents a
        # second payment from being recorded there.
        recorded_remaining = amount_paid
        erp_payment_rows = []
        recorded_paid = Decimal("0")
        for index, payment in enumerate(checkout_payments, start=1):
            ledger_amount = min(Decimal(str(payment.amount)), recorded_remaining)
            if ledger_amount <= 0:
                continue
            recorded_paid += ledger_amount
            recorded_remaining -= ledger_amount
            erp_payment_rows.append(
                InvoicePayment(
                    receipt_number=f"POS-RCP-{invoice.id}-{index}",
                    invoice_id=invoice.id,
                    business_profile_id=self.user.business_profile_id,
                    customer_id=order.customer_id,
                    outlet_id=self.user.outlet_id,
                    amount=ledger_amount,
                    payment_method=payment.method,
                    transaction_reference=payment.reference_no,
                    transaction_type="payment",
                    status="successful",
                    notes=f"POS checkout {invoice.invoice_number}",
                    received_by=self.user.staff.employee_code,
                    paid_at=datetime.now(timezone.utc),
                    invoice_total_snapshot=t.grand_total,
                    previous_paid_amount=recorded_paid - ledger_amount,
                    total_paid_after=recorded_paid,
                    remaining_after=max(Decimal("0"), t.grand_total - recorded_paid),
                    payment_status_after="Paid" if recorded_paid >= t.grand_total else "Partially Paid",
                )
            )
        if erp_payment_rows:
            self.db.add_all(erp_payment_rows)
        cash_total = sum(
            (payment.amount for payment in checkout_payments if payment.method == "cash"),
            Decimal("0"),
        )
        if cash_total > 0:
            self.db.add(
                CashDrawerEvent(
                    business_profile_id=self.user.business_profile_id,
                    outlet_id=self.user.outlet_id,
                    staff_id=self.user.id,
                    shift_id=shift_id,
                    terminal_id=self.terminal_id,
                    event_type="sale_cash_in",
                    amount=cash_total,
                    reason=f"Invoice {invoice.invoice_number}",
                    metadata_json={"order_id": order.id, "invoice_id": invoice.id},
                )
            )

        line_by_item_id = {ln.order_item_id: ln for ln in view.lines}
        ledger_keys = [
            f"POS:CHECKOUT:{order.id}:{it.id}:{it.product_id}:SALE"
            for it in order.items
        ]
        existing_ledger_keys = set()
        if ledger_keys:
            existing_ledger_keys = set(
                (
                    await self.db.execute(
                        select(InventoryLedger.idempotency_key).where(
                            InventoryLedger.idempotency_key.in_(ledger_keys)
                        )
                    )
                )
                .scalars()
                .all()
            )

        invoice_items: list[InvoiceItem] = []
        inventory_ledgers: list[InventoryLedger] = []
        product_quantities: list[ProductQuantity] = []

        # Apply inventory + revenue per line
        for it in order.items:
            product = locked_products.get(it.product_id)
            line = line_by_item_id.get(it.id)
            if line:
                tax_parts = split_gst(line.line_total, line.gst_rate, req.inter_state)
                invoice_items.append(
                    InvoiceItem(
                        invoice_id=invoice.id,
                        order_item_id=it.id,
                        product_id=it.product_id,
                        product_name=product.name if product else f"Product #{it.product_id}",
                        barcode=product.barcode if product else None,
                        sku=product.sku if product else None,
                        category=product.category if product else None,
                        quantity=line.quantity,
                        unit_price=line.rate,
                        discount_pct=line.discount_pct,
                        discount_amount=money((line.rate * line.quantity) - line.line_total),
                        tax_rate=line.gst_rate,
                        tax_amount=money(tax_parts["cgst"] + tax_parts["sgst"] + tax_parts["igst"]),
                        total=money(line.line_total + tax_parts["cgst"] + tax_parts["sgst"] + tax_parts["igst"]),
                        mrp=product.mrp if product else None,
                    )
                )
            if product:
                quantity_sold = Decimal(str(it.quantity))
                idempotency_key = f"POS:CHECKOUT:{order.id}:{it.id}:{product.id}:SALE"
                if idempotency_key in existing_ledger_keys:
                    logger.info(
                        "event=inventory_idempotent_replay product_id=%s idempotency_key=%s source=POS reference_id=%s",
                        product.id,
                        idempotency_key,
                        invoice.id,
                    )
                    continue
                product.qty_sold += quantity_sold
                old_stock = Decimal(str(product.stock_cached or 0))
                movement_result = self.inventory_rules.apply(
                    InventoryMovement(
                        movement_type=InventoryMovementType.SALE,
                        product_id=product.id,
                        quantity=quantity_sold,
                        business_profile_id=self.user.business_profile_id,
                        outlet_id=self.user.outlet_id,
                        reason="sale",
                        reference_type="invoice",
                        reference_id=str(invoice.id),
                        idempotency_key=idempotency_key,
                        user_id=str(self.user.id),
                        source="POS",
                    ),
                    current_stock=old_stock,
                )
                product.stock_cached = movement_result.new_stock
                if Decimal(str(product.stock_cached)) < 0:
                    logger.warning(
                        "event=inventory_negative_blocked product_id=%s change=%s current_stock=%s source=POS reference_id=%s",
                        product.id,
                        -quantity_sold,
                        Decimal(str(product.stock_cached)) + quantity_sold,
                        invoice.id,
                    )
                    raise BusinessRuleError(f"Insufficient stock for {product.name}")
                inventory_ledgers.append(
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
                    "event=inventory_update product_id=%s change=%s new_stock=%s source=POS reference_type=invoice reference_id=%s idempotency_key=%s",
                    product.id,
                    movement_result.stock_delta,
                    product.stock_cached,
                    invoice.id,
                    idempotency_key,
                )
                product_quantities.append(
                    ProductQuantity(
                        product_id=product.id,
                        business_profile_id=self.user.business_profile_id,
                        transaction_type="sale",
                        quantity_change=movement_result.stock_delta,
                        remaining_quantity=product.stock_cached,
                        reference_order_id=order.id,
                        note=f"Sale {invoice.invoice_number}",
                    )
                )

        if invoice_items:
            self.db.add_all(invoice_items)
        if inventory_ledgers:
            self.db.add_all(inventory_ledgers)
        if product_quantities:
            self.db.add_all(product_quantities)

        # Update customer stats
        if order.customer_id:
            cust = await self.customers.get(order.customer_id)
            if cust:
                cust.total_spent = Decimal(str(cust.total_spent)) + t.grand_total
                cust.purchase_count += 1
                cust.last_purchase_amount = t.grand_total
                cust.last_purchase_at = date.today()

        order.status = CART_STATUS_COMPLETED
        order.payment_status = invoice_status
        order.inventory_applied = True
        order.expires_at = None
        order.lease_expires_at = None

        await self.db.flush()
        log_stage("persist_sale")
        await self.audit.log(
            "checkout", "invoice", invoice.id,
            {
                "order": order.order_number,
                "order_id": order.id,
                "grand_total": str(t.grand_total),
                "payment_method": payment_method,
                "amount_paid": str(amount_paid),
                "balance_due": str(balance_due),
                "change_due": str(change_due),
            },
            flush=False,
        )
        await self.audit.log(
            "cart_completed",
            "cart",
            order.id,
            {"order": order.order_number, "invoice_id": invoice.id},
            flush=False,
        )
        _, public_token = await InvoiceLinkService(self.db).create_link(invoice)
        public_invoice_url = InvoiceLinkService.build_public_invoice_url(public_token)
        notification_status = await self.notifications.queue_invoice_notifications(
            invoice,
            public_url=public_invoice_url,
        )
        log_stage("audit_link_and_notifications")
        setattr(invoice, "amount_paid", amount_paid)
        setattr(invoice, "balance_due", balance_due)
        setattr(invoice, "change_due", change_due)
        setattr(invoice, "payments", payment_rows)
        setattr(invoice, "notification_status", notification_status)
        setattr(invoice, "public_invoice_url", public_invoice_url)
        await self.db.refresh(invoice)
        setattr(invoice, "amount_paid", amount_paid)
        setattr(invoice, "balance_due", balance_due)
        setattr(invoice, "change_due", change_due)
        setattr(invoice, "payments", payment_rows)
        setattr(invoice, "notification_status", notification_status)
        setattr(invoice, "public_invoice_url", public_invoice_url)
        log_stage("prepare_response")
        return invoice

    async def _get_draft(self, order_id: int) -> Order:
        order = await self.orders.get(order_id)
        if not order:
            raise NotFoundError("Cart not found")
        if await self._expire_order_if_needed(order):
            raise BusinessRuleError("Cart is no longer editable", code="CART_NOT_EDITABLE")
        if order.status != CART_STATUS_DRAFT:
            raise BusinessRuleError("Cart is no longer editable", code="CART_NOT_EDITABLE")
        if order.staff_id != self.user.id:
            raise BusinessRuleError("Cart belongs to another Sales Person")
        if order.business_profile_id != self.user.business_profile_id:
            raise BusinessRuleError("Cart belongs to another business")
        if order.outlet_id != self.user.outlet_id:
            raise BusinessRuleError("Cart belongs to another outlet")
        self._ensure_cart_lease(order)
        return order
