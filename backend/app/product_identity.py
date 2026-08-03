"""Canonical product-name identity within a business profile."""
from __future__ import annotations

import re

from sqlalchemy.orm import Session

from app.models import Product


def normalize_product_name(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip()).casefold()


def clean_product_name(value: str) -> str:
    return re.sub(r"\s+", " ", str(value or "").strip())


def find_active_product_by_name(
    db: Session,
    *,
    name: str,
    business_profile_id: int | None,
    exclude_product_id: int | None = None,
    lock: bool = False,
) -> Product | None:
    normalized_name = normalize_product_name(name)
    if not normalized_name:
        return None
    query = db.query(Product).filter(Product.is_active.is_(True))
    if business_profile_id is None:
        query = query.filter(Product.business_profile_id.is_(None))
    else:
        query = query.filter(Product.business_profile_id == business_profile_id)
    if exclude_product_id is not None:
        query = query.filter(Product.id != exclude_product_id)
    if lock:
        query = query.with_for_update()
    return next(
        (product for product in query.all() if normalize_product_name(product.name) == normalized_name),
        None,
    )
