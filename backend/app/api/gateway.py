from fastapi import APIRouter

from app.api import audit_logs, business, customers, dashboard, files, inventory_audit, invoices, masters, orders, payments, products, public_invoices, supplier_returns, waybills

api_gateway = APIRouter(prefix="/api/v1")

api_gateway.include_router(business.router)
api_gateway.include_router(dashboard.router)
api_gateway.include_router(inventory_audit.router)
api_gateway.include_router(products.router)
api_gateway.include_router(masters.router)
api_gateway.include_router(orders.router)
api_gateway.include_router(invoices.router)
api_gateway.include_router(payments.router)
api_gateway.include_router(public_invoices.router)
api_gateway.include_router(waybills.router)
api_gateway.include_router(files.router)
api_gateway.include_router(supplier_returns.router)
api_gateway.include_router(audit_logs.router)
api_gateway.include_router(customers.router)
