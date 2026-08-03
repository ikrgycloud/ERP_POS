"""Shared ERP/POS domain foundation.

The package is intentionally framework-neutral: no FastAPI, SQLAlchemy, HTTP,
or database session imports belong here. ERP and POS should converge on these
business rules through adapters in their own applications.
"""

from shared_domain.documents import DocumentFamily
from shared_domain.finance.money import money
from shared_domain.inventory import InventoryDisposition, InventoryMovementType
from shared_domain.tax.gst import split_gst

__all__ = [
    "DocumentFamily",
    "InventoryDisposition",
    "InventoryMovementType",
    "money",
    "split_gst",
]
