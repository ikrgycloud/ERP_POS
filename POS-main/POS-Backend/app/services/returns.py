"""Return service — submission and automatic reversal processing.

Submitting a return records the request. Processing runs the whole
auto-sequence from the workflow doc:
  1. generate a reversal invoice (is_reverse = TRUE, linked to original)
  2. move returned stock into Damaged Inventory
  3. adjust revenue via the reversal invoice + refund payment (direction=out)
  4. mark refund / replacement and advance status to completed
The original invoice is never mutated.
"""
from datetime import date, timedelta
from decimal import Decimal

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import CurrentUser
from app.core.exceptions import BusinessRuleError, NotFoundError
from app.models.catalog import DamagedInventory, InventoryLedger
from app.models.org import Staff
from app.models.sales import CashDrawerEvent, Customer, InvoiceItem, Payment, Return, ReturnItem
from app.repositories.repos import (
    InvoiceRepository,
    ProductQuantityRepository,
    ProductRepository,
    OrderItemRepository,
    ReturnItemRepository,
    ReturnRepository,
)
from app.schemas.transactions import ReturnCreate
from app.services.common import AuditService, NumberService
from app.services.return_evidence import ReturnEvidenceService
from app.utils.helpers import gen_number, money, split_gst
from shared_domain.finance import (
    PaymentRequest as DomainPaymentRequest,
    PaymentService as DomainPaymentService,
)
from shared_domain.inventory import (
    InventoryDisposition,
    InventoryMovement,
    InventoryMovementService as DomainInventoryMovementService,
    InventoryMovementType,
)
from shared_domain.returns import ReturnService as DomainReturnService

VALID_TRANSITIONS = {
    "submitted": {"verified", "rejected"},
    "verified": {"approved", "rejected"},
    "approved": {"reversal_generated", "rejected"},
    "reversal_generated": {"completed"},
    "completed": set(),
    "rejected": set(),
}


class ReturnService:
    def __init__(self, db: AsyncSession, user: CurrentUser):
        self.db = db
        self.user = user
        self.returns = ReturnRepository(db)
        self.return_items = ReturnItemRepository(db)
        self.invoices = InvoiceRepository(db)
        self.order_items = OrderItemRepository(db)
        self.products = ProductRepository(db)
        self.stock = ProductQuantityRepository(db)
        self.numbers = NumberService(db)
        self.audit = AuditService(db, user.business_profile_id)
        self.evidence = ReturnEvidenceService(db)
        self.return_rules = DomainReturnService()
        self.inventory_rules = DomainInventoryMovementService()
        self.payment_rules = DomainPaymentService()

    async def submit(self, payload: ReturnCreate) -> Return:
        original = await self.invoices.get_visible(
            payload.original_invoice_id,
            self.user.business_profile_id,
            self.user.outlet_id,
        )
        if not original:
            raise NotFoundError("Original invoice not found")
        if original.is_reverse:
            raise BusinessRuleError("Cannot return against a reversal invoice")
        if not payload.items:
            raise BusinessRuleError("A return needs at least one item")
        if not original.order_id:
            raise BusinessRuleError("Original invoice has no source order")

        invoice_items = await self._validate_items_against_invoice(original.id, payload)

        seq = await self.numbers.next_return_seq()
        ret = await self.returns.create(
            business_profile_id=self.user.business_profile_id,
            return_number=gen_number("RET", seq),
            original_invoice_id=original.id,
            outlet_id=self.user.outlet_id,
            customer_id=original.customer_id,
            staff_id=self.user.id,
            return_date=date.today(),
            reason=payload.reason,
            resolution=payload.resolution,
            refund_method=payload.refund_method,
            refund_status="pending",
            status="submitted",
            remarks=payload.remarks,
        )

        total_refund = Decimal("0")
        for line in payload.items:
            source_line = invoice_items[id(line)]
            sold_quantity = Decimal(str(source_line.quantity))
            return_quantity = Decimal(str(line.quantity))
            discount, refund = self.return_rules.line_refund(
                unit_price=Decimal(str(source_line.unit_price)),
                return_quantity=return_quantity,
                sold_quantity=sold_quantity,
                invoice_line_discount=Decimal(str(source_line.discount_amount or 0)),
            )
            total_refund += refund
            self.db.add(
                ReturnItem(
                    return_id=ret.id,
                    product_id=source_line.product_id,
                    order_item_id=source_line.order_item_id,
                    quantity=line.quantity,
                    rate=source_line.unit_price,
                    discount=discount,
                    gst_rate=source_line.tax_rate,
                    line_refund=refund,
                    damage_type=line.damage_type,
                    remarks=line.remarks,
                )
            )
        ret.refund_amount = money(total_refund)
        await self.db.flush()
        await self.audit.log("submit", "return", ret.id, {"number": ret.return_number})
        await self.db.refresh(ret)
        return ret

    async def _validate_items_against_invoice(
        self,
        invoice_id: int,
        payload: ReturnCreate,
    ) -> dict[int, InvoiceItem]:
        original = await self.invoices.get_with_items(invoice_id)
        if not original:
            raise NotFoundError("Original invoice not found")

        by_invoice_item_id = {item.id: item for item in original.items}
        by_product_id: dict[int, list[InvoiceItem]] = {}
        for item in original.items:
            by_product_id.setdefault(item.product_id, []).append(item)

        requested_by_invoice_item: dict[int, Decimal] = {}
        resolved: dict[int, InvoiceItem] = {}
        for line in payload.items:
            source_line = None
            if line.invoice_item_id is not None:
                source_line = by_invoice_item_id.get(line.invoice_item_id)
            elif line.product_id is not None:
                candidates = by_product_id.get(line.product_id, [])
                if len(candidates) == 1:
                    source_line = candidates[0]
                elif len(candidates) > 1:
                    raise BusinessRuleError(
                        "invoice_item_id is required when an invoice has repeated products"
                    )
            if not source_line:
                raise BusinessRuleError("Return item must reference a product from the original invoice")
            if line.product_id is not None and line.product_id != source_line.product_id:
                raise BusinessRuleError("Return item product does not match invoice item")

            requested_by_invoice_item[source_line.id] = requested_by_invoice_item.get(
                source_line.id,
                Decimal("0"),
            ) + Decimal(str(line.quantity))
            resolved[id(line)] = source_line

        for invoice_item_id, requested_quantity in requested_by_invoice_item.items():
            source_line = by_invoice_item_id[invoice_item_id]
            sold_quantity = Decimal(str(source_line.quantity))
            already_returned = await self._returned_quantity_for_line(
                invoice_id,
                source_line,
            )
            available = sold_quantity - already_returned
            if requested_quantity > available:
                raise BusinessRuleError(
                    f"Return quantity for product {source_line.product_id} exceeds available quantity"
                )
        return resolved

    async def _returned_quantity_for_line(self, invoice_id: int, source_line: InvoiceItem) -> Decimal:
        stmt = (
            select(func.coalesce(func.sum(ReturnItem.quantity), 0))
            .join(Return, Return.id == ReturnItem.return_id)
            .where(
                Return.original_invoice_id == invoice_id,
                Return.status != "rejected",
                ReturnItem.product_id == source_line.product_id,
            )
        )
        if source_line.order_item_id is not None:
            stmt = stmt.where(ReturnItem.order_item_id == source_line.order_item_id)
        return Decimal(str((await self.db.execute(stmt)).scalar_one()))

    async def set_status(self, return_id: int, new_status: str) -> Return:
        ret = await self._get_visible_return(return_id, for_update=True)
        if ret.status == "completed" and new_status in {
            "approved",
            "reversal_generated",
            "completed",
        }:
            return ret
        allowed = VALID_TRANSITIONS.get(ret.status, set())
        if new_status not in allowed:
            raise BusinessRuleError(
                f"Cannot move return from '{ret.status}' to '{new_status}'"
            )
        self.return_rules.assert_transition(ret.status, new_status)
        if new_status == "approved":
            await self._assert_evidence_ready(ret)
        ret.status = new_status
        if new_status == "approved":
            ret.refund_status = "initiated"
        await self.db.flush()
        await self.audit.log("status", "return", ret.id, {"status": new_status})
        await self.db.refresh(ret)
        return ret

    async def get_visible(self, return_id: int) -> Return:
        return await self._get_visible_return(return_id)

    async def process(self, return_id: int, inter_state: bool = False) -> Return:
        """Run the full auto-sequence. Requires status 'approved'."""
        ret = await self._get_visible_return(return_id, for_update=True)
        if ret.status == "completed" and ret.reversal_invoice_id:
            return ret
        if ret.status != "approved":
            raise BusinessRuleError("Return must be 'approved' before processing")
        if ret.reversal_invoice_id:
            raise BusinessRuleError("Reversal already generated")
        await self._assert_evidence_ready(ret)

        original = await self.invoices.get_visible(
            ret.original_invoice_id,
            self.user.business_profile_id,
        )
        if not original:
            raise NotFoundError("Original invoice not found")

        # 1. Reversal invoice (negative-effect credit note) ----------------
        taxable = money(sum((Decimal(str(i.line_refund)) for i in ret.items), Decimal("0")))
        cgst = sgst = igst = Decimal("0")
        for i in sorted(ret.items, key=lambda item: (item.product_id, item.id or 0)):
            parts = split_gst(i.line_refund, i.gst_rate, inter_state)
            cgst += parts["cgst"]
            sgst += parts["sgst"]
            igst += parts["igst"]
        seq = await self.numbers.next_invoice_seq()
        reversal = await self.invoices.create(
            business_profile_id=self.user.business_profile_id,
            invoice_number=gen_number("REV", seq),
            invoice_type="reversal",
            invoice_direction="customer_to_outlet",
            linked_invoice_id=original.id,
            outlet_id=ret.outlet_id,
            customer_id=ret.customer_id,
            staff_id=ret.staff_id,
            is_reverse=True,
            party_type="customer",
            party_name=original.party_name,
            date=date.today(),
            due_date=date.today() + timedelta(days=0),
            taxable_value=taxable,
            cgst=money(cgst),
            sgst=money(sgst),
            igst=money(igst),
            status="Refunded",
        )
        ret.reversal_invoice_id = reversal.id

        ret.refund_status = "processing"

        # 2. Route returned inventory by reason ----------------------------
        for i in ret.items:
            product = await self.products.get_for_update(i.product_id)
            if product and product.business_profile_id != self.user.business_profile_id:
                product = None
            parts = split_gst(i.line_refund, i.gst_rate, inter_state)
            self.db.add(
                InvoiceItem(
                    invoice_id=reversal.id,
                    order_item_id=i.order_item_id,
                    product_id=i.product_id,
                    product_name=product.name if product else f"Product #{i.product_id}",
                    barcode=product.barcode if product else None,
                    sku=product.sku if product else None,
                    category=product.category if product else None,
                    quantity=i.quantity,
                    unit_price=i.rate,
                    discount_pct=0,
                    discount_amount=i.discount,
                    tax_rate=i.gst_rate,
                    tax_amount=money(parts["cgst"] + parts["sgst"] + parts["igst"]),
                    total=money(i.line_refund + parts["cgst"] + parts["sgst"] + parts["igst"]),
                    mrp=product.mrp if product else None,
                )
            )
            if product:
                await self._apply_return_inventory(ret, i, product)

        # 3. Refund payment (money out) ------------------------------------
        refund_total = money(taxable + cgst + sgst + igst)
        if ret.resolution == "refund":
            refund_payment = self.payment_rules.record_refund(
                DomainPaymentRequest(
                    amount=refund_total,
                    method=ret.refund_method or "cash",
                ),
                max_refundable=refund_total,
            )
            self.db.add(
                Payment(
                    business_profile_id=self.user.business_profile_id,
                    invoice_id=reversal.id,
                    outlet_id=ret.outlet_id,
                    staff_id=ret.staff_id,
                    method=refund_payment.method,
                    amount=refund_payment.amount,
                    direction=refund_payment.direction,
                )
            )
            if refund_payment.method == "cash":
                self.db.add(
                    CashDrawerEvent(
                        business_profile_id=self.user.business_profile_id,
                        outlet_id=ret.outlet_id,
                        staff_id=self.user.id,
                        shift_id=None,
                        terminal_id=None,
                        event_type="refund_cash_out",
                        amount=refund_payment.amount,
                        reason=f"Return {ret.return_number}",
                        metadata_json={
                            "return_id": ret.id,
                            "reversal_invoice_id": reversal.id,
                        },
                    )
                )
        ret.refund_amount = refund_total
        ret.refund_status = "completed"

        if ret.customer_id:
            customer = await self.db.get(Customer, ret.customer_id)
            if customer:
                customer.total_spent = max(
                    Decimal("0"),
                    Decimal(str(customer.total_spent or 0)) - refund_total,
                )

        # 4. Advance lifecycle ---------------------------------------------
        ret.status = "completed"
        await self.db.flush()
        await self.audit.log(
            "process", "return", ret.id,
            {"reversal": reversal.invoice_number, "refund": str(refund_total)},
        )
        await self.db.refresh(ret)
        return ret

    async def _assert_evidence_ready(self, ret: Return) -> None:
        if not ret.evidence_required:
            return
        if ret.evidence_count:
            return
        has_evidence = await self.evidence.has_evidence(
            ret.id,
            business_profile_id=self.user.business_profile_id,
        )
        if not has_evidence:
            raise BusinessRuleError(
                "Photo evidence is required before approving or processing this return"
            )

    async def _apply_return_inventory(self, ret: Return, item: ReturnItem, product) -> None:
        quantity = Decimal(str(item.quantity))
        reason = self.return_rules.normalize_reason(item.damage_type or ret.reason)
        planned_disposition = self.return_rules.inventory_disposition(reason)
        disposition_label = (
            "sellable"
            if planned_disposition == InventoryDisposition.AVAILABLE
            else planned_disposition.value
        )
        old_stock = Decimal(str(product.stock_cached or 0))
        movement_result = self.inventory_rules.apply(
            InventoryMovement(
                movement_type=InventoryMovementType.RETURN,
                product_id=product.id,
                quantity=quantity,
                business_profile_id=self.user.business_profile_id,
                outlet_id=ret.outlet_id,
                reason=reason,
                reference_type="return",
                reference_id=str(ret.id),
                idempotency_key=f"POS:RETURN:{ret.id}:{item.id}:{product.id}:{disposition_label}",
                user_id=str(self.user.id),
                source="POS",
            ),
            current_stock=old_stock,
        )
        disposition = disposition_label

        for field, delta in movement_result.statistic_deltas.items():
            if hasattr(product, field):
                setattr(product, field, Decimal(str(getattr(product, field) or 0)) + delta)
        product.stock_cached = movement_result.new_stock

        new_stock = Decimal(str(product.stock_cached or 0))
        idempotency_key = movement_result.ledger_entry.idempotency_key
        existing = await self.db.execute(
            select(InventoryLedger).where(InventoryLedger.idempotency_key == idempotency_key)
        )
        if not existing.scalar_one_or_none():
            self.db.add(
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

        await self.stock.create(
            product_id=product.id,
            business_profile_id=self.user.business_profile_id,
            transaction_type=f"return_{disposition}",
            quantity_change=movement_result.stock_delta,
            remaining_quantity=new_stock,
            reference_order_id=None,
            note=f"Return {ret.return_number}: {reason}",
        )

        if movement_result.disposition != InventoryDisposition.AVAILABLE:
            self.db.add(
                DamagedInventory(
                    business_profile_id=self.user.business_profile_id,
                    product_id=product.id,
                    outlet_id=ret.outlet_id,
                    return_id=ret.id,
                    return_item_id=item.id,
                    quantity=item.quantity,
                    damage_type=reason,
                    disposition=disposition,
                    recorded_by=self.user.id,
                )
            )

    async def _get_visible_return(self, return_id: int, for_update: bool = False) -> Return:
        if for_update:
            stmt = select(Return).where(Return.id == return_id).with_for_update()
            ret = (await self.db.execute(stmt)).scalar_one_or_none()
        else:
            ret = await self.returns.get(return_id)
        if not ret or ret.business_profile_id != self.user.business_profile_id:
            raise NotFoundError("Return not found")
        if self.user.role.value == "sales_manager":
            staff = await self.db.get(Staff, ret.staff_id) if ret.staff_id else None
            if not staff or staff.manager_id != self.user.id:
                raise NotFoundError("Return not found")
        if self.user.role.value == "sales_person" and ret.staff_id != self.user.id:
            raise NotFoundError("Return not found")
        return ret
