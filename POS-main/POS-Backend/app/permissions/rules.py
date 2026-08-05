"""Permission model layered on top of roles."""
from enum import Enum

from app.core.roles import Role


class Permission(str, Enum):
    MANAGE_STAFF = "manage_staff"
    MANAGE_CATALOG = "manage_catalog"
    VIEW_REPORTS = "view_reports"
    BILL_CUSTOMERS = "bill_customers"
    SUBMIT_RETURNS = "submit_returns"
    PROCESS_RETURNS = "process_returns"


ROLE_PERMISSIONS: dict[Role, set[Permission]] = {
    Role.BRANCH_MANAGER: {
        Permission.MANAGE_STAFF,
        Permission.MANAGE_CATALOG,
        Permission.VIEW_REPORTS,
        Permission.PROCESS_RETURNS,
    },
    Role.SALES_MANAGER: {
        Permission.MANAGE_STAFF,
        Permission.VIEW_REPORTS,
    },
    Role.SALES_PERSON: {
        Permission.BILL_CUSTOMERS,
        Permission.SUBMIT_RETURNS,
    },
}


def has_permission(role: Role, permission: Permission) -> bool:
    return permission in ROLE_PERMISSIONS.get(role, set())
