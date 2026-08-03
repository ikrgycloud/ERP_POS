"""Dashboard domain."""

from shared_domain.dashboard.dtos import DashboardSummary
from shared_domain.dashboard.service import DashboardAggregationService

__all__ = ["DashboardAggregationService", "DashboardSummary"]
