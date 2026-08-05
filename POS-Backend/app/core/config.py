from enum import Enum
from functools import lru_cache
import ipaddress
from pathlib import Path
from urllib.parse import urlparse
from typing import List

from pydantic import AliasChoices, Field, computed_field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Environment(str, Enum):
    DEVELOPMENT = "development"
    TESTING = "testing"
    STAGING = "staging"
    PRODUCTION = "production"
    CI = "ci"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # --- App ---
    APP_NAME: str = "POS + ERP API"
    APP_VERSION: str = "1.0.0"
    API_V1_PREFIX: str = "/api/v1"
    ENVIRONMENT: Environment = Field(default=Environment.DEVELOPMENT, validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV"))
    HOST: str = "0.0.0.0"
    PORT: int = 8000
    DEBUG: bool = False

    # --- Database ---
    RAW_DATABASE_URL: str | None = Field(
        default=None,
        validation_alias=AliasChoices(
            "DATABASE_URL_OVERRIDE",
            "DATABASE_URL",
            "ERP_DATABASE_URL",
        ),
    )
    DB_ECHO: bool = False
    DB_POOL_SIZE: int = 10
    DB_MAX_OVERFLOW: int = 20
    DB_INIT_RETRIES: int = Field(default=5, ge=1, le=30)
    DB_INIT_RETRY_SECONDS: float = Field(default=1.0, ge=0.1, le=30)
    DB_HEALTH_TIMEOUT_SECONDS: float = Field(default=5.0, ge=0.5, le=30)
    AUTO_CREATE_DATABASE: bool = False
    AUTO_CREATE_TABLES: bool = False
    ALLOW_DEV_SEED: bool = False

    # --- Security ---
    SECRET_KEY: str = Field(
        default="CHANGE_ME_IN_PRODUCTION_use_openssl_rand_hex_32",
        validation_alias=AliasChoices("SECRET_KEY", "JWT_SECRET_KEY"),
    )
    JWT_SECRET_KEY: str | None = None
    ALGORITHM: str = Field(default="HS256", validation_alias=AliasChoices("JWT_ALGORITHM", "ALGORITHM"))
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7
    PASSWORD_MIN_LENGTH: int = Field(default=6, ge=6, le=128)
    LOGIN_MAX_ATTEMPTS: int = Field(default=5, ge=1, le=20)
    LOGIN_LOCK_SECONDS: int = Field(default=300, ge=30, le=86400)

    # --- CORS / middleware ---
    CORS_ORIGINS: str = "*"
    TRUSTED_HOSTS: str = "*"
    ENABLE_HTTPS_REDIRECT: bool = False
    RATE_LIMIT_ENABLED: bool = True
    RATE_LIMIT_REQUESTS: int = Field(default=120, ge=1, le=10000)
    RATE_LIMIT_WINDOW_SECONDS: int = Field(default=60, ge=1, le=3600)
    # Keep product catalogs isolated by business unless a deployment explicitly opts in.
    POS_GLOBAL_PRODUCT_CATALOG: bool = False
    CART_DRAFT_EXPIRY_MINUTES: int = Field(default=720, ge=1, le=10080)
    CART_LEASE_TIMEOUT_SECONDS: int = Field(default=120, ge=10, le=3600)
    CART_CLEANUP_WORKER_ENABLED: bool = True
    CART_CLEANUP_WORKER_INTERVAL_SECONDS: int = Field(default=300, ge=10, le=86400)
    CART_CLEANUP_BATCH_SIZE: int = Field(default=100, ge=1, le=1000)
    UPLOAD_DIR: str = "uploads"
    STATIC_DIR: str = "static"
    MEDIA_BASE_URL: str = "auto"
    MAX_UPLOAD_BYTES: int = Field(default=15 * 1024 * 1024, ge=1, le=15 * 1024 * 1024)

    # --- Invoice notifications ---
    EMAIL_ENABLED: bool = False
    SMS_ENABLED: bool = False
    TWILIO_ENABLED: bool = False
    WHATSAPP_ENABLED: bool = False
    NOTIFICATION_WORKER_ENABLED: bool = True
    NOTIFICATION_RETRY_COUNT: int = Field(default=3, ge=0, le=10)
    NOTIFICATION_RETRY_DELAY_SECONDS: int = Field(default=60, ge=1, le=86400)
    NOTIFICATION_WORKER_INTERVAL_SECONDS: int = Field(
        default=10,
        ge=1,
        le=3600,
        validation_alias=AliasChoices("NOTIFICATION_WORKER_INTERVAL_SECONDS", "BACKGROUND_WORKER_INTERVAL"),
    )
    NOTIFICATION_BATCH_SIZE: int = Field(default=20, ge=1, le=100)
    INVOICE_PUBLIC_BASE_URL: str = Field(
        default="",
        validation_alias=AliasChoices("INVOICE_PUBLIC_BASE_URL"),
    )
    INVOICE_LINK_EXPIRY_HOURS: int = Field(default=24, ge=1, le=87600)
    RETURN_EVIDENCE_LINK_EXPIRY_HOURS: int = Field(default=24, ge=1, le=720)
    DEFAULT_CUSTOMER_COUNTRY_CODE: str = "+91"
    TWILIO_ACCOUNT_SID: str | None = None
    TWILIO_AUTH_TOKEN: str | None = None
    TWILIO_PHONE_NUMBER: str | None = Field(
        default=None,
        validation_alias=AliasChoices("TWILIO_PHONE_NUMBER", "TWILIO_FROM_NUMBER"),
    )
    TWILIO_WHATSAPP_NUMBER: str | None = None

    # --- Email / object storage aliases for shared deployment contracts ---
    SMTP_HOST: str | None = None
    SMTP_PORT: int = 587
    SMTP_USERNAME: str | None = None
    SMTP_PASSWORD: str | None = None
    SMTP_FROM: str | None = Field(default=None, validation_alias=AliasChoices("SMTP_FROM", "SMTP_FROM_EMAIL"))
    S3_BUCKET: str | None = Field(default=None, validation_alias=AliasChoices("S3_BUCKET", "AWS_S3_BUCKET_NAME"))
    S3_REGION: str | None = Field(default=None, validation_alias=AliasChoices("S3_REGION", "AWS_REGION"))
    S3_ACCESS_KEY: str | None = Field(default=None, validation_alias=AliasChoices("S3_ACCESS_KEY", "AWS_ACCESS_KEY_ID"))
    S3_SECRET_KEY: str | None = Field(default=None, validation_alias=AliasChoices("S3_SECRET_KEY", "AWS_SECRET_ACCESS_KEY"))

    # --- Logging ---
    LOG_LEVEL: str = "INFO"
    LOG_FORMAT: str = "text"
    LOG_FILE: str = "logs/app.log"
    LOG_SQL: bool = False

    @property
    def BACKGROUND_WORKER_INTERVAL(self) -> int:
        return self.NOTIFICATION_WORKER_INTERVAL_SECONDS

    @property
    def sms_enabled(self) -> bool:
        return self.SMS_ENABLED or self.TWILIO_ENABLED

    @property
    def email_enabled(self) -> bool:
        return self.EMAIL_ENABLED

    @property
    def whatsapp_enabled(self) -> bool:
        return self.WHATSAPP_ENABLED

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]

    @property
    def trusted_hosts(self) -> List[str]:
        configured_hosts = [h.strip() for h in self.TRUSTED_HOSTS.split(",") if h.strip()]
        if self.ENVIRONMENT == Environment.DEVELOPMENT:
            return ["*"]
        return configured_hosts or ["*"]

    @property
    def is_production(self) -> bool:
        return self.ENVIRONMENT == Environment.PRODUCTION

    @property
    def is_deployed(self) -> bool:
        return self.ENVIRONMENT in {Environment.STAGING, Environment.PRODUCTION}

    @computed_field
    @property
    def DATABASE_URL(self) -> str:
        """Async SQLAlchemy URL generated from the shared ERP database URL."""
        if not self.RAW_DATABASE_URL:
            raise ValueError("DATABASE_URL must be set to the shared ERP PostgreSQL database")
        return self._as_async_postgres_url(self.RAW_DATABASE_URL)

    def media_url_for(self, request_base_url: str | None = None, path: str = "") -> str:
        base_value = self.MEDIA_BASE_URL if self.MEDIA_BASE_URL != "auto" else request_base_url or ""
        base = base_value.rstrip("/")
        relative_path = path.strip("/")
        if relative_path and not relative_path.startswith("media/"):
            relative_path = f"media/{relative_path}"
        normalized_path = f"/{relative_path}" if relative_path else "/media"
        if not base:
            return normalized_path

        parsed = urlparse(base)
        base_path = parsed.path.rstrip("/")
        if base_path.endswith("/media") or base_path == "/media":
            if relative_path.startswith("media/"):
                relative_path = relative_path.removeprefix("media/")
            normalized_path = f"/{relative_path}" if relative_path else ""
        return f"{base}{normalized_path}"

    def public_frontend_base_url(self, _request_origin: str | None = None) -> str:
        configured = (self.INVOICE_PUBLIC_BASE_URL or "").strip()
        if not configured or configured.lower() == "auto":
            request_origin = self._public_request_origin(_request_origin)
            if request_origin:
                return request_origin
            return "http://localhost:5173" if self.ENVIRONMENT == Environment.DEVELOPMENT else ""
        return configured.rstrip("/")

    @staticmethod
    def _public_request_origin(origin: str | None) -> str:
        if not origin:
            return ""
        normalized = origin.strip().rstrip("/")
        parsed = urlparse(normalized)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            return ""
        if parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
            return ""
        host = parsed.hostname or ""
        if host in {"localhost", "127.0.0.1", "::1"}:
            return ""
        try:
            ip = ipaddress.ip_address(host)
            if ip.is_private or ip.is_loopback or ip.is_link_local:
                return ""
        except ValueError:
            labels = host.lower().split(".")
            if (
                host.lower().endswith(".local")
                or host.lower().endswith(".internal")
                or len(labels) == 1
            ):
                return ""
        return normalized

    def _invoice_public_base_url_errors(self) -> list[str]:
        errors: list[str] = []
        configured = (self.INVOICE_PUBLIC_BASE_URL or "").strip()
        base = self.public_frontend_base_url()
        if self.is_deployed and (not configured or configured.lower() == "auto"):
            errors.append("INVOICE_PUBLIC_BASE_URL is required for staging/production")
            return errors
        if not base:
            errors.append("INVOICE_PUBLIC_BASE_URL is required")
            return errors

        parsed = urlparse(base)
        if parsed.scheme not in {"http", "https"} or not parsed.netloc:
            errors.append("INVOICE_PUBLIC_BASE_URL must be an absolute http(s) URL")
            return errors
        if base.rstrip("/") != base or parsed.path not in {"", "/"} or parsed.params or parsed.query or parsed.fragment:
            errors.append("INVOICE_PUBLIC_BASE_URL must be an origin only, without path, query, or fragment")
        host = parsed.hostname or ""
        is_local = host in {"localhost", "127.0.0.1", "::1"}
        try:
            ip = ipaddress.ip_address(host)
            is_private_host = ip.is_private or ip.is_loopback or ip.is_link_local
        except ValueError:
            labels = host.lower().split(".")
            is_private_host = (
                host.lower().endswith(".local")
                or host.lower().endswith(".internal")
                or host.lower().endswith(".amazonaws.com.internal")
                or len(labels) == 1 and not is_local
            )
        if self.is_deployed:
            if parsed.scheme != "https":
                errors.append("INVOICE_PUBLIC_BASE_URL must start with https:// in staging/production")
            if is_local or is_private_host:
                errors.append("INVOICE_PUBLIC_BASE_URL must be a public domain in staging/production")
        elif parsed.scheme == "http" and not is_local:
            errors.append("HTTP INVOICE_PUBLIC_BASE_URL is allowed only for localhost in development")
        return errors

    @staticmethod
    def _mask(value: str | None, *, visible: int = 4) -> str | None:
        if not value:
            return None
        text = str(value)
        if len(text) <= visible:
            return "*" * len(text)
        return f"{'*' * max(len(text) - visible, 0)}{text[-visible:]}"

    def notification_configuration_errors(self) -> list[str]:
        errors: list[str] = []
        errors.extend(self._invoice_public_base_url_errors())
        if self.sms_enabled:
            if not self.TWILIO_ACCOUNT_SID:
                errors.append("TWILIO_ACCOUNT_SID is required when SMS is enabled")
            if not self.TWILIO_AUTH_TOKEN:
                errors.append("TWILIO_AUTH_TOKEN is required when SMS is enabled")
            if not self.TWILIO_PHONE_NUMBER:
                errors.append("TWILIO_PHONE_NUMBER is required when SMS is enabled")
        if self.whatsapp_enabled:
            if not self.TWILIO_ACCOUNT_SID:
                errors.append("TWILIO_ACCOUNT_SID is required when WhatsApp is enabled")
            if not self.TWILIO_AUTH_TOKEN:
                errors.append("TWILIO_AUTH_TOKEN is required when WhatsApp is enabled")
            if not self.TWILIO_WHATSAPP_NUMBER:
                errors.append("TWILIO_WHATSAPP_NUMBER is required when WhatsApp is enabled")
        return errors

    def notification_config_summary(self) -> dict:
        return {
            "email_enabled": self.email_enabled,
            "sms_enabled": self.sms_enabled,
            "whatsapp_enabled": self.whatsapp_enabled,
            "worker_enabled": self.NOTIFICATION_WORKER_ENABLED,
            "twilio_sms_configured": bool(
                self.TWILIO_ACCOUNT_SID and self.TWILIO_AUTH_TOKEN and self.TWILIO_PHONE_NUMBER
            ),
            "twilio_whatsapp_configured": bool(
                self.TWILIO_ACCOUNT_SID and self.TWILIO_AUTH_TOKEN and self.TWILIO_WHATSAPP_NUMBER
            ),
            "twilio_account_sid": self._mask(self.TWILIO_ACCOUNT_SID),
            "twilio_phone_number": self._mask(self.TWILIO_PHONE_NUMBER),
            "twilio_whatsapp_number": self._mask(self.TWILIO_WHATSAPP_NUMBER),
            "smtp_configured": bool(self.SMTP_HOST and self.SMTP_USERNAME and self.SMTP_PASSWORD and self.SMTP_FROM),
            "notification_batch_size": self.NOTIFICATION_BATCH_SIZE,
            "default_customer_country_code": self.DEFAULT_CUSTOMER_COUNTRY_CODE,
            "invoice_public_base_url": self.INVOICE_PUBLIC_BASE_URL,
            "configuration_errors": self.notification_configuration_errors(),
        }

    @staticmethod
    def _as_async_postgres_url(value: str) -> str:
        normalized = value.strip()
        if normalized.startswith("postgresql://"):
            return normalized.replace("postgresql://", "postgresql+asyncpg://", 1)
        if normalized.startswith("postgres://"):
            return normalized.replace("postgres://", "postgresql+asyncpg://", 1)
        return normalized

    @field_validator("RAW_DATABASE_URL", mode="before")
    @classmethod
    def empty_database_url_to_none(cls, value):
        if isinstance(value, str) and not value.strip():
            return None
        return value

    @field_validator("DEBUG", mode="before")
    @classmethod
    def parse_debug(cls, value):
        if isinstance(value, str) and value.lower() in {"release", "prod", "production"}:
            return False
        return value

    @field_validator("ENVIRONMENT", mode="before")
    @classmethod
    def parse_environment(cls, value):
        if isinstance(value, Environment):
            return value
        normalized = str(value or "development").strip().lower()
        if normalized == "prod":
            return Environment.PRODUCTION
        if normalized == "dev":
            return Environment.DEVELOPMENT
        return normalized

    @field_validator("LOG_LEVEL")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if normalized not in allowed:
            raise ValueError(f"LOG_LEVEL must be one of {sorted(allowed)}")
        return normalized

    @model_validator(mode="after")
    def validate_production_settings(self):
        if self.JWT_SECRET_KEY and self.SECRET_KEY.startswith("CHANGE_ME"):
            self.SECRET_KEY = self.JWT_SECRET_KEY
        if self.is_production:
            if self.DEBUG:
                raise ValueError("DEBUG must be false in production")
            if self.SECRET_KEY.startswith("CHANGE_ME"):
                raise ValueError("SECRET_KEY must be set in production")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS cannot contain '*' in production")
            if "*" in self.trusted_hosts:
                raise ValueError("TRUSTED_HOSTS cannot contain '*' in production")
            if self.AUTO_CREATE_DATABASE or self.AUTO_CREATE_TABLES:
                raise ValueError("AUTO_CREATE_DATABASE/AUTO_CREATE_TABLES must be false in production")
            if self.ALLOW_DEV_SEED:
                raise ValueError("ALLOW_DEV_SEED must be false in production")
        if self.is_deployed:
            notification_errors = self.notification_configuration_errors()
            if notification_errors:
                raise ValueError("; ".join(notification_errors))
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=(Path(__file__).resolve().parent.parent.parent / ".env").as_posix())


settings = get_settings()
