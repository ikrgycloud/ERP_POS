"""Return domain DTOs."""

from dataclasses import dataclass
from datetime import date


@dataclass(frozen=True, slots=True)
class ReturnApproval:
    return_id: int
    approved_by: int
    approval_date: date
    manager_note: str | None = None

    def __post_init__(self) -> None:
        if self.return_id <= 0:
            raise ValueError("return_id must be positive")
        if self.approved_by <= 0:
            raise ValueError("approved_by must be positive")
