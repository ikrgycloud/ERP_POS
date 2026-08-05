"""Role definitions and RBAC dependency factory."""
from enum import Enum


class Role(str, Enum):
    BRANCH_MANAGER = "branch_manager"
    SALES_MANAGER = "sales_manager"
    SALES_PERSON = "sales_person"


# Convenience groupings used across endpoints
ALL_ROLES = {Role.BRANCH_MANAGER, Role.SALES_MANAGER, Role.SALES_PERSON}
MANAGERS = {Role.BRANCH_MANAGER, Role.SALES_MANAGER}
ADMIN_ONLY = {Role.BRANCH_MANAGER}
SALES_ONLY = {Role.SALES_PERSON}
