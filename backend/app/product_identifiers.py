"""Product identifier generation and validation.

Product identifiers are generated only on the backend. Sequences live in the
database so generated values survive restarts, restores, and concurrent users.
"""
from __future__ import annotations

import re
from dataclasses import dataclass

from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.models import DocumentSequence, Product

SKU_SEQUENCE_PREFIX = "product-sku:business:"
BARCODE_SEQUENCE_FAMILY = "product-barcode:global"
SKU_PATTERN = re.compile(r"^[A-Z0-9][A-Z0-9._-]{1,78}[A-Z0-9]$")
BARCODE_PATTERN = re.compile(r"^[0-9]{6,32}$")


@dataclass(frozen=True)
class ProductIdentifiers:
    sku: str
    barcode: str


class ProductIdentifierError(ValueError):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.message = message


def _business_key(business_profile_id: int | None) -> str:
    return f"{business_profile_id:06d}" if business_profile_id is not None else "GLOBAL"


def product_sku_family(business_profile_id: int | None) -> str:
    return f"{SKU_SEQUENCE_PREFIX}{_business_key(business_profile_id)}"


def _next_sequence_value(db: Session, family: str) -> int:
    if db.bind is not None and db.bind.dialect.name == "postgresql":
        row = db.execute(
            text(
                """
                INSERT INTO document_sequences (family, next_value)
                VALUES (:family, 2)
                ON CONFLICT (family)
                DO UPDATE SET next_value = document_sequences.next_value + 1
                RETURNING next_value - 1
                """
            ),
            {"family": family},
        ).scalar_one()
        return int(row)

    sequence = db.query(DocumentSequence).filter(DocumentSequence.family == family).with_for_update().first()
    if sequence is None:
        sequence = DocumentSequence(family=family, next_value=1)
        db.add(sequence)
        db.flush()
    value = int(sequence.next_value)
    sequence.next_value = value + 1
    db.flush()
    return value


def format_sku(business_profile_id: int | None, sequence_value: int) -> str:
    return f"SKU-BP{_business_key(business_profile_id)}-{sequence_value:06d}"


def format_barcode(sequence_value: int) -> str:
    return f"29{sequence_value:011d}"


def generate_product_identifiers(db: Session, business_profile_id: int | None) -> ProductIdentifiers:
    sku = format_sku(
        business_profile_id,
        _next_sequence_value(db, product_sku_family(business_profile_id)),
    )
    barcode = format_barcode(_next_sequence_value(db, BARCODE_SEQUENCE_FAMILY))
    return ProductIdentifiers(sku=sku, barcode=barcode)


def generate_product_sku(db: Session, business_profile_id: int | None) -> str:
    return format_sku(
        business_profile_id,
        _next_sequence_value(db, product_sku_family(business_profile_id)),
    )


def generate_product_barcode(db: Session) -> str:
    return format_barcode(_next_sequence_value(db, BARCODE_SEQUENCE_FAMILY))


def normalize_manual_barcode(value: str | None) -> str | None:
    if value is None:
        return None
    barcode = re.sub(r"\s+", "", str(value))
    if not barcode:
        return None
    if not BARCODE_PATTERN.fullmatch(barcode):
        raise ProductIdentifierError(
            "INVALID_BARCODE",
            "Barcode must be numeric and 6 to 32 digits",
        )
    return barcode


def normalize_manual_sku(value: str | None) -> str | None:
    if value is None:
        return None
    sku = str(value).strip().upper()
    if not sku:
        return None
    if not SKU_PATTERN.fullmatch(sku):
        raise ProductIdentifierError("INVALID_PRODUCT_CODE", "Product code contains invalid characters")
    return sku


def assert_barcode_available(
    db: Session,
    *,
    barcode: str,
    business_profile_id: int | None,
    exclude_product_id: int | None = None,
) -> None:
    query = db.query(Product).filter(Product.barcode == barcode)
    if business_profile_id is not None:
        query = query.filter(Product.business_profile_id == business_profile_id)
    else:
        query = query.filter(Product.business_profile_id.is_(None))
    if exclude_product_id is not None:
        query = query.filter(Product.id != exclude_product_id)
    if query.first():
        raise ProductIdentifierError("BARCODE_ALREADY_EXISTS", "Product barcode already exists")


def product_integrity_error(exc: IntegrityError) -> ProductIdentifierError:
    message = str(getattr(exc, "orig", exc))
    if "uq_products_business_normalized_name" in message:
        return ProductIdentifierError("PRODUCT_ALREADY_EXISTS", "An active product with this name already exists")
    if "uq_products_business_barcode" in message or "products_business_profile_id_barcode" in message:
        return ProductIdentifierError("BARCODE_ALREADY_EXISTS", "Product barcode already exists")
    if "uq_products_business_sku" in message or "products_business_profile_id_sku" in message:
        return ProductIdentifierError("SKU_ALREADY_EXISTS", "Product SKU already exists")
    return ProductIdentifierError("PRODUCT_IDENTIFIER_CONFLICT", "Product identifier already exists")
