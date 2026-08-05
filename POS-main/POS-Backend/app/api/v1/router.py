"""Aggregate all v1 endpoint routers."""
from fastapi import APIRouter

from app.api.v1.endpoints import (
    auth,
    billing,
    catalog,
    enterprise,
    notifications,
    reports,
    returns,
    settings,
    staff,
)

api_router = APIRouter()
api_router.include_router(auth.router)
api_router.include_router(staff.router)
api_router.include_router(catalog.router)
api_router.include_router(billing.router)
api_router.include_router(enterprise.router)
api_router.include_router(returns.router)
api_router.include_router(reports.router)
api_router.include_router(settings.router)
api_router.include_router(notifications.router)
