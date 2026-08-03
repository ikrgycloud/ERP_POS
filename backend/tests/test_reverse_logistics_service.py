from decimal import Decimal
import os
from pathlib import Path
import sys

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+pysqlite:///:memory:")
sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.models import DamagedInventory, Product, Supplier, SupplierReturn, WorkflowStatus  # noqa: E402
from app.reverse_logistics_service import (  # noqa: E402
    CreateSupplierReturnCommand,
    ReverseLogisticsConcurrencyError,
    ReverseLogisticsService,
    SupplierReturnLineCommand,
    TransitionCommand,
)


class FakeReverseLogisticsRepository:
    def __init__(self):
        self.supplier = Supplier(id=10, business_profile_id=1, name="Acme", is_active=True)
        self.product = Product(
            id=20,
            business_profile_id=1,
            sku="SKU-20",
            name="Bottle",
            category="General",
            supplier="Acme",
            qty_bought=Decimal("0"),
            qty_sold=Decimal("0"),
            stock_cached=Decimal("5"),
            mrp=Decimal("20"),
            buy_price=Decimal("10"),
            sell_price=Decimal("18"),
            gst_rate=Decimal("5"),
            reorder_level=Decimal("0"),
            is_active=True,
        )
        self.damaged = DamagedInventory(
            id=30,
            business_profile_id=1,
            product_id=20,
            outlet_id=2,
            quantity=Decimal("4"),
            available_quantity=Decimal("4"),
            inspected_quantity=Decimal("0"),
            returned_to_supplier_quantity=Decimal("0"),
            inspection_status="pending",
            disposition="quarantined",
            version=1,
        )
        self.statuses = {
            ("supplier_return", "draft"): WorkflowStatus(
                id=1,
                module="supplier_return",
                code="draft",
                label="Draft",
                sequence=10,
                is_initial=True,
                is_terminal=False,
                is_active=True,
                allowed_next=["pending_approval"],
            ),
            ("supplier_return", "pending_approval"): WorkflowStatus(
                id=2,
                module="supplier_return",
                code="pending_approval",
                label="Pending Approval",
                sequence=20,
                is_initial=False,
                is_terminal=False,
                is_active=True,
                allowed_next=["approved"],
            ),
            ("supplier_return_item", "pending_inspection"): WorkflowStatus(
                id=3,
                module="supplier_return_item",
                code="pending_inspection",
                label="Pending Inspection",
                sequence=10,
                is_initial=True,
                is_terminal=False,
                is_active=True,
                allowed_next=["inspection_completed"],
            ),
        }
        self.supplier_return = None
        self.events = []
        self.histories = []

    def get_supplier_return(self, supplier_return_id, *, lock=False):
        return self.supplier_return if self.supplier_return and self.supplier_return.id == supplier_return_id else None

    def add_supplier_return(self, supplier_return):
        supplier_return.id = 40
        supplier_return.current_status = self.statuses[("supplier_return", "draft")]
        self.supplier_return = supplier_return
        return supplier_return

    def get_supplier_return_item(self, item_id, *, lock=False):
        return next((item for item in self.supplier_return.items if item.id == item_id), None)

    def get_damaged_inventory(self, damaged_inventory_id, *, lock=False):
        return self.damaged if damaged_inventory_id == self.damaged.id else None

    def get_product(self, product_id, *, lock=False):
        return self.product if product_id == self.product.id else None

    def get_supplier(self, supplier_id):
        return self.supplier if supplier_id == self.supplier.id else None

    def get_workflow_status(self, business_profile_id, module, code):
        return self.statuses.get((module, code))

    def list_workflow_statuses(self, business_profile_id, module):
        return [status for (status_module, _), status in self.statuses.items() if status_module == module]

    def list_approval_levels(self, business_profile_id, module):
        return []

    def list_approval_actions(self, supplier_return_id):
        return []

    def add_inspection_report(self, report):
        report.id = 50
        return report

    def add_status_history(self, history):
        self.histories.append(history)
        return history

    def add_approval_history(self, history):
        return history

    def add_supplier_response(self, response):
        return response

    def add_replacement(self, replacement):
        return replacement

    def add_credit_note(self, credit_note):
        return credit_note

    def add_shipment(self, shipment):
        return shipment

    def add_inventory_ledger(self, ledger):
        return ledger

    def add_domain_event(self, event, aggregate_type, aggregate_id):
        self.events.append((event, aggregate_type, aggregate_id))
        return event

    def flush(self):
        for index, item in enumerate(self.supplier_return.items, start=1):
            if item.id is None:
                item.id = index


def test_create_supplier_return_reserves_damaged_quantity_and_records_event():
    repo = FakeReverseLogisticsRepository()
    service = ReverseLogisticsService(repo)

    supplier_return = service.create_supplier_return(
        CreateSupplierReturnCommand(
            business_profile_id=1,
            supplier_id=10,
            rtv_number="RTV-1",
            created_by_staff_id=5,
            lines=(
                SupplierReturnLineCommand(
                    damaged_inventory_id=30,
                    product_id=20,
                    quantity=Decimal("2"),
                    reason="manufacturing_defect",
                ),
            ),
        )
    )

    assert supplier_return.id == 40
    assert repo.damaged.available_quantity == Decimal("2")
    assert repo.damaged.returned_to_supplier_quantity == Decimal("2")
    assert supplier_return.items[0].product_snapshot["name"] == "Bottle"
    assert repo.histories[0].action == "created"
    assert repo.events[0][0].__class__.__name__ == "SupplierReturnCreated"


def test_transition_requires_expected_aggregate_version():
    repo = FakeReverseLogisticsRepository()
    service = ReverseLogisticsService(repo)
    supplier_return = service.create_supplier_return(
        CreateSupplierReturnCommand(
            business_profile_id=1,
            supplier_id=10,
            rtv_number="RTV-1",
            created_by_staff_id=5,
            lines=(SupplierReturnLineCommand(30, 20, Decimal("1")),),
        )
    )

    with pytest.raises(ReverseLogisticsConcurrencyError):
        service.transition_supplier_return(
            TransitionCommand(
                supplier_return_id=supplier_return.id,
                to_status="pending_approval",
                actor_staff_id=5,
                expected_version=99,
            )
        )
