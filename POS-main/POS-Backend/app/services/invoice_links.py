"""Secure public invoice link generation and lookup."""
import hashlib
import hmac
from datetime import datetime, timedelta, timezone
from base64 import urlsafe_b64decode, urlsafe_b64encode

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.exceptions import NotFoundError
from app.models.org import BusinessProfile
from app.models.sales import Invoice, InvoiceItem, InvoicePublicLink
from app.schemas.notifications import (
    PublicInvoiceBusiness,
    PublicInvoiceItem,
    PublicInvoiceOut,
)


class InvoiceLinkService:
    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def token_hash(token: str) -> str:
        return hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            token.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

    @staticmethod
    @staticmethod
    def build_public_invoice_url(token: str) -> str:
        base_url = settings.public_frontend_base_url()
        return f"{base_url}/invoice/view/{token}"

    @staticmethod
    def public_url(token: str) -> str:
        return InvoiceLinkService.build_public_invoice_url(token)

    @staticmethod
    def _b64(data: bytes) -> str:
        return urlsafe_b64encode(data).decode("ascii").rstrip("=")

    @staticmethod
    def _unb64(data: str) -> bytes:
        padded = data + "=" * (-len(data) % 4)
        return urlsafe_b64decode(padded.encode("ascii"))

    @classmethod
    def _signed_token(cls, invoice_id: int, expires_at: datetime) -> str:
        if expires_at.tzinfo is None:
            expires_at = expires_at.replace(tzinfo=timezone.utc)
        expires = expires_at.astimezone(timezone.utc).isoformat()
        payload = f"{invoice_id}|{expires}"
        signature = hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        return cls._b64(f"{payload}:{signature}".encode("utf-8"))

    @classmethod
    def _verify_signed_token(cls, token: str) -> int | None:
        try:
            decoded = cls._unb64(token).decode("utf-8")
            invoice_id, signed_tail = decoded.split("|", 1)
            expires, signature = signed_tail.rsplit(":", 1)
        except Exception:
            return None
        payload = f"{invoice_id}|{expires}"
        expected = hmac.new(
            settings.SECRET_KEY.encode("utf-8"),
            payload.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()
        if not hmac.compare_digest(signature, expected):
            return None
        try:
            return int(invoice_id)
        except ValueError:
            return None

    @staticmethod
    def _as_utc(value: datetime | None) -> datetime | None:
        if value is None:
            return None
        if value.tzinfo is None:
            return value.replace(tzinfo=timezone.utc)
        return value.astimezone(timezone.utc)

    def _token_for_link(self, link: InvoicePublicLink) -> str:
        if not link.expires_at:
            raise ValueError("Invoice link has no expiry")
        return self._signed_token(link.invoice_id, self._as_utc(link.expires_at) or link.expires_at)

    async def get_or_create_active_link(self, invoice: Invoice) -> tuple[InvoicePublicLink, str]:
        now = datetime.now(timezone.utc)
        active_links = (
            await self.db.execute(
                select(InvoicePublicLink)
                .where(
                    InvoicePublicLink.invoice_id == invoice.id,
                    InvoicePublicLink.business_profile_id == invoice.business_profile_id,
                    InvoicePublicLink.customer_id == invoice.customer_id,
                    InvoicePublicLink.revoked_at.is_(None),
                    or_expiry_active(now),
                )
                .order_by(InvoicePublicLink.created_at.desc(), InvoicePublicLink.id.desc())
            )
        ).scalars().all()
        for link in active_links:
            try:
                token = self._token_for_link(link)
            except ValueError:
                continue
            if hmac.compare_digest(link.token_hash, self.token_hash(token)):
                return link, token
        return await self.create_link(invoice)

    async def create_link(self, invoice: Invoice) -> tuple[InvoicePublicLink, str]:
        expires_at = datetime.now(timezone.utc) + timedelta(hours=settings.INVOICE_LINK_EXPIRY_HOURS)
        token = self._signed_token(invoice.id, expires_at)
        link = InvoicePublicLink(
            invoice_id=invoice.id,
            business_profile_id=invoice.business_profile_id,
            customer_id=invoice.customer_id,
            token_hash=self.token_hash(token),
            expires_at=expires_at,
        )
        self.db.add(link)
        await self.db.flush()
        return link, token

    async def get_public_invoice(self, token: str) -> PublicInvoiceOut:
        signed_invoice_id = self._verify_signed_token(token)
        link = (
            await self.db.execute(
                select(InvoicePublicLink).where(
                    InvoicePublicLink.token_hash == self.token_hash(token),
                    InvoicePublicLink.revoked_at.is_(None),
                )
            )
        ).scalar_one_or_none()
        now = datetime.now(timezone.utc)
        expires_at = self._as_utc(link.expires_at) if link else None
        if not link or (expires_at and expires_at < now):
            raise NotFoundError("Invoice link not found or expired")
        if signed_invoice_id is not None and signed_invoice_id != link.invoice_id:
            raise NotFoundError("Invoice link not found or expired")

        invoice = (
            await self.db.execute(select(Invoice).where(Invoice.id == link.invoice_id))
        ).scalar_one_or_none()
        if (
            not invoice
            or invoice.business_profile_id != link.business_profile_id
            or invoice.customer_id != link.customer_id
            or invoice.is_reverse
        ):
            raise NotFoundError("Invoice link not found or expired")
        business = await self.db.get(BusinessProfile, invoice.business_profile_id)
        items = (
            await self.db.execute(
                select(InvoiceItem).where(InvoiceItem.invoice_id == invoice.id).order_by(InvoiceItem.id)
            )
        ).scalars().all()

        link.open_count += 1
        link.opened_at = now
        await self.db.flush()

        return PublicInvoiceOut(
            business=PublicInvoiceBusiness(
                name=(
                    business.invoice_company_name
                    or business.trade_name
                    or business.legal_name
                    if business
                    else "Store"
                ),
                gstin=business.gstin if business else None,
                address=business.billing_address if business else None,
                city=business.city if business else None,
            ),
            invoice_number=invoice.invoice_number,
            invoice_date=invoice.date,
            customer_name=invoice.party_name,
            items=[
                PublicInvoiceItem(
                    product_name=item.product_name,
                    barcode=item.barcode,
                    sku=item.sku,
                    category=item.category,
                    quantity=item.quantity,
                    unit_price=item.unit_price,
                    discount_pct=item.discount_pct,
                    discount_amount=item.discount_amount,
                    tax_rate=item.tax_rate,
                    tax_amount=item.tax_amount,
                    total=item.total,
                )
                for item in items
            ],
            taxable_value=invoice.taxable_value,
            cgst=invoice.cgst,
            sgst=invoice.sgst,
            igst=invoice.igst,
            grand_total=invoice.grand_total,
            payment_method=invoice.payment_method,
            paid_status=invoice.status,
            barcode_value=invoice.invoice_number,
            qr_value=self.public_url(token),
            expires_at=expires_at,
            return_policy="Returns or exchanges are accepted as per store policy with the original invoice.",
            footer="Computer Generated Invoice",
        )


def or_expiry_active(now: datetime):
    return and_(
        InvoicePublicLink.expires_at.is_not(None),
        InvoicePublicLink.expires_at > now,
    )
