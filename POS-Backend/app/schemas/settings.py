"""Schemas for tenant-scoped POS settings."""
from pydantic import BaseModel, Field, field_validator


class InvoiceBrandingOut(BaseModel):
    company_name: str


class InvoiceBrandingUpdate(BaseModel):
    company_name: str | None = Field(default=None, max_length=200)

    @field_validator("company_name", mode="before")
    @classmethod
    def normalize_company_name(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            normalized = " ".join(value.strip().split())
            return normalized or None
        return value
