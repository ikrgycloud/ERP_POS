"""Report domain DTOs."""

from dataclasses import dataclass
from decimal import Decimal


@dataclass(frozen=True, slots=True)
class ReportSummary:
    name: str
    total: Decimal = Decimal("0")
    count: int = 0
    export_formats: tuple[str, ...] = ("csv", "excel", "pdf")
