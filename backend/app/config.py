from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import AliasChoices, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


EnvironmentName = Literal["development", "testing", "staging", "production"]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Resolve the backend environment file explicitly so Uvicorn behaves
        # consistently regardless of the folder it was launched from.
        env_file=Path(__file__).resolve().parents[1] / ".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = Field(default="ERP Backend", validation_alias=AliasChoices("APP_NAME"))
    environment: EnvironmentName = Field(
        default="development",
        validation_alias=AliasChoices("ENVIRONMENT", "APP_ENV"),
    )
    host: str = Field(default="0.0.0.0", validation_alias=AliasChoices("HOST"))
    port: int = Field(default=8001, validation_alias=AliasChoices("PORT"))

    database_url: str = Field(validation_alias=AliasChoices("DATABASE_URL", "ERP_DATABASE_URL"))
    auto_create_tables: bool = Field(default=False, validation_alias=AliasChoices("AUTO_CREATE_TABLES"))
    allow_dev_seed: bool = Field(default=False, validation_alias=AliasChoices("ALLOW_DEV_SEED"))

    cors_origins_raw: str = Field(
        default="",
        validation_alias=AliasChoices("CORS_ORIGINS", "FRONTEND_ORIGINS"),
    )
    trusted_hosts_raw: str = Field(default="*", validation_alias=AliasChoices("TRUSTED_HOSTS"))

    register_key: str = Field(default="change-me", validation_alias=AliasChoices("REGISTER_KEY"))
    secret_key: str | None = Field(default=None, validation_alias=AliasChoices("SECRET_KEY"))
    jwt_secret_key: str = Field(
        default="change-this-jwt-secret",
        validation_alias=AliasChoices("JWT_SECRET_KEY", "SECRET_KEY"),
    )
    jwt_algorithm: str = Field(default="HS256", validation_alias=AliasChoices("JWT_ALGORITHM"))
    access_token_expire_minutes: int = Field(
        default=480,
        validation_alias=AliasChoices("ACCESS_TOKEN_EXPIRE_MINUTES"),
    )
    refresh_token_expire_days: int = Field(
        default=7,
        validation_alias=AliasChoices("REFRESH_TOKEN_EXPIRE_DAYS"),
    )

    media_base_url: str = Field(default="auto", validation_alias=AliasChoices("MEDIA_BASE_URL"))
    public_app_base_url: str = Field(
        default="http://localhost:8001",
        validation_alias=AliasChoices("ERP_PUBLIC_BASE_URL", "PUBLIC_APP_BASE_URL"),
    )
    public_invoice_link_expiry_hours: int = Field(
        default=720,
        validation_alias=AliasChoices("PUBLIC_INVOICE_LINK_EXPIRY_HOURS"),
    )
    upload_dir: str = Field(default="uploads", validation_alias=AliasChoices("UPLOAD_DIR"))
    static_dir: str = Field(default="static", validation_alias=AliasChoices("STATIC_DIR"))

    log_level: str = Field(default="INFO", validation_alias=AliasChoices("LOG_LEVEL"))
    log_format: str = Field(default="text", validation_alias=AliasChoices("LOG_FORMAT"))
    log_file: str = Field(default="logs/erp-backend.log", validation_alias=AliasChoices("LOG_FILE"))
    rate_limit_enabled: bool = Field(default=False, validation_alias=AliasChoices("RATE_LIMIT_ENABLED"))

    smtp_host: str = Field(default="smtp.gmail.com", validation_alias=AliasChoices("SMTP_HOST"))
    smtp_port: int = Field(default=587, validation_alias=AliasChoices("SMTP_PORT"))
    smtp_username: str | None = Field(default=None, validation_alias=AliasChoices("SMTP_USERNAME"))
    smtp_password: str | None = Field(default=None, validation_alias=AliasChoices("SMTP_PASSWORD"))
    smtp_from: str | None = Field(
        default=None,
        validation_alias=AliasChoices("SMTP_FROM", "SMTP_FROM_EMAIL"),
    )

    sms_enabled_raw: bool = Field(default=False, validation_alias=AliasChoices("SMS_ENABLED"))
    twilio_enabled: bool = Field(default=False, validation_alias=AliasChoices("TWILIO_ENABLED"))
    twilio_account_sid: str | None = Field(default=None, validation_alias=AliasChoices("TWILIO_ACCOUNT_SID"))
    twilio_auth_token: str | None = Field(default=None, validation_alias=AliasChoices("TWILIO_AUTH_TOKEN"))
    twilio_phone_number: str | None = Field(
        default=None,
        validation_alias=AliasChoices("TWILIO_PHONE_NUMBER", "TWILIO_FROM_NUMBER"),
    )
    whatsapp_enabled: bool = Field(default=False, validation_alias=AliasChoices("WHATSAPP_ENABLED"))
    default_customer_country_code: str = Field(default="+91", validation_alias=AliasChoices("DEFAULT_CUSTOMER_COUNTRY_CODE"))

    s3_bucket: str | None = Field(default=None, validation_alias=AliasChoices("S3_BUCKET", "AWS_S3_BUCKET_NAME"))
    s3_region: str | None = Field(default=None, validation_alias=AliasChoices("S3_REGION", "AWS_REGION"))
    s3_access_key: str | None = Field(default=None, validation_alias=AliasChoices("S3_ACCESS_KEY", "AWS_ACCESS_KEY_ID"))
    s3_secret_key: str | None = Field(default=None, validation_alias=AliasChoices("S3_SECRET_KEY", "AWS_SECRET_ACCESS_KEY"))

    notification_worker_enabled: bool = Field(
        default=True,
        validation_alias=AliasChoices("NOTIFICATION_WORKER_ENABLED"),
    )
    notification_worker_version: str = Field(
        default="modern-outbox-v1",
        validation_alias=AliasChoices("NOTIFICATION_WORKER_VERSION"),
    )
    background_worker_interval: int = Field(
        default=10,
        validation_alias=AliasChoices("BACKGROUND_WORKER_INTERVAL"),
    )
    notification_batch_size: int = Field(
        default=50,
        validation_alias=AliasChoices("NOTIFICATION_BATCH_SIZE"),
    )
    notification_retry_schedule_seconds: str = Field(
        default="60,300,900,1800,3600,21600",
        validation_alias=AliasChoices("NOTIFICATION_RETRY_SCHEDULE_SECONDS"),
    )

    @property
    def notification_retry_schedule(self) -> list[int]:
        values: list[int] = []
        for item in self._parse_csv(self.notification_retry_schedule_seconds):
            try:
                seconds = int(item)
            except ValueError:
                continue
            if seconds > 0:
                values.append(seconds)
        return values or [60, 300, 900, 1800, 3600, 21600]

    @property
    def app_env(self) -> str:
        return self.environment

    @property
    def is_production(self) -> bool:
        return self.environment == "production"

    @property
    def frontend_origins(self) -> str:
        return self.cors_origins_raw

    @property
    def cors_origins(self) -> list[str]:
        return self._parse_csv(self.cors_origins_raw)

    @property
    def trusted_hosts(self) -> list[str]:
        return self._parse_csv(self.trusted_hosts_raw) or ["*"]

    @property
    def smtp_from_email(self) -> str | None:
        return self.smtp_from

    @property
    def twilio_from_number(self) -> str | None:
        return self.twilio_phone_number

    @property
    def sms_enabled(self) -> bool:
        return self.sms_enabled_raw or self.twilio_enabled

    @property
    def aws_access_key_id(self) -> str | None:
        return self.s3_access_key

    @property
    def aws_secret_access_key(self) -> str | None:
        return self.s3_secret_key

    @property
    def aws_region(self) -> str | None:
        return self.s3_region

    @property
    def aws_s3_bucket_name(self) -> str | None:
        return self.s3_bucket

    def media_url_for(self, request_base_url: str | None = None, path: str = "") -> str:
        base = (request_base_url or "").rstrip("/") if self.media_base_url == "auto" else self.media_base_url.rstrip("/")
        normalized_path = path if path.startswith("/") else f"/{path}" if path else ""
        return f"{base}{normalized_path}" if base else normalized_path

    @property
    def public_base_url(self) -> str:
        return self.public_app_base_url.strip().rstrip("/")

    @staticmethod
    def _parse_csv(value: str) -> list[str]:
        return [item.strip() for item in value.split(",") if item.strip()]

    @field_validator("environment", mode="before")
    @classmethod
    def normalize_environment(cls, value: str) -> str:
        normalized = str(value or "development").strip().lower()
        if normalized == "prod":
            return "production"
        if normalized == "dev":
            return "development"
        return normalized

    @field_validator("log_level")
    @classmethod
    def validate_log_level(cls, value: str) -> str:
        normalized = value.upper()
        allowed = {"DEBUG", "INFO", "WARNING", "ERROR", "CRITICAL"}
        if normalized not in allowed:
            raise ValueError(f"LOG_LEVEL must be one of {sorted(allowed)}")
        return normalized

    @model_validator(mode="after")
    def validate_settings(self):
        if self.secret_key and self.jwt_secret_key == "change-this-jwt-secret":
            self.jwt_secret_key = self.secret_key
        if self.is_production:
            if self.jwt_secret_key == "change-this-jwt-secret" or len(self.jwt_secret_key) < 32:
                raise ValueError("JWT_SECRET_KEY must be a strong secret in production")
            if "*" in self.cors_origins:
                raise ValueError("CORS_ORIGINS cannot contain '*' in production")
            if "*" in self.trusted_hosts:
                raise ValueError("TRUSTED_HOSTS cannot contain '*' in production")
            if not self.cors_origins:
                raise ValueError("CORS_ORIGINS must be set in production")
            if self.auto_create_tables:
                raise ValueError("AUTO_CREATE_TABLES must be false in production")
            if self.allow_dev_seed:
                raise ValueError("ALLOW_DEV_SEED must be false in production")
            if not self.public_base_url.startswith("https://"):
                raise ValueError("ERP_PUBLIC_BASE_URL must use HTTPS in production")
        return self


@lru_cache
def get_settings() -> Settings:
    return Settings(_env_file=(Path(__file__).resolve().parents[1] / ".env").as_posix())
