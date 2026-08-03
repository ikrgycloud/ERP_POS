"""Cache invalidation and future realtime sync DTOs."""

from dataclasses import dataclass
from enum import StrEnum


class SyncDomain(StrEnum):
    PRODUCTS = "products"
    INVENTORY = "inventory"
    INVOICES = "invoices"
    RETURNS = "returns"
    PAYMENTS = "payments"
    CUSTOMERS = "customers"
    SUPPLIERS = "suppliers"
    STAFF = "staff"
    DASHBOARD = "dashboard"
    REPORTS = "reports"
    SETTINGS = "settings"


@dataclass(frozen=True, slots=True)
class CacheInvalidation:
    domains: tuple[SyncDomain, ...]
    source_path: str | None = None
    method: str | None = None
