"""Signed public invoice PDF links for customer-facing notifications."""

import base64
import hashlib
import hmac
from datetime import datetime, timedelta, timezone

from app.config import get_settings


def _encode(value: bytes) -> str:
    return base64.urlsafe_b64encode(value).decode("ascii").rstrip("=")


def _decode(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


def create_public_invoice_token(invoice_id: int, business_profile_id: int | None) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(hours=max(1, settings.public_invoice_link_expiry_hours))
    payload = f"{invoice_id}|{business_profile_id or 0}|{int(expires_at.timestamp())}"
    signature = hmac.new(settings.jwt_secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256).hexdigest()
    return _encode(f"{payload}|{signature}".encode("utf-8"))


def verify_public_invoice_token(token: str) -> tuple[int, int | None] | None:
    settings = get_settings()
    try:
        invoice_id_raw, tenant_id_raw, expires_at_raw, signature = _decode(token).decode("utf-8").split("|", 3)
        payload = f"{invoice_id_raw}|{tenant_id_raw}|{expires_at_raw}"
        expected = hmac.new(
            settings.jwt_secret_key.encode("utf-8"), payload.encode("utf-8"), hashlib.sha256
        ).hexdigest()
        if not hmac.compare_digest(signature, expected) or int(expires_at_raw) < int(datetime.now(timezone.utc).timestamp()):
            return None
        tenant_id = int(tenant_id_raw)
        return int(invoice_id_raw), tenant_id or None
    except (UnicodeDecodeError, ValueError):
        return None


def public_invoice_pdf_url(invoice_id: int, business_profile_id: int | None) -> str:
    settings = get_settings()
    token = create_public_invoice_token(invoice_id, business_profile_id)
    return f"{settings.public_base_url}/api/v1/public/invoices/{token}/pdf"
