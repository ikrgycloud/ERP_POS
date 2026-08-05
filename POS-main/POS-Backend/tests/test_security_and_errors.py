"""Security and error-shape regression tests."""
import pytest
from pydantic import ValidationError

from tests.conftest import login
from app.core.config import Environment, Settings

pytestmark = pytest.mark.asyncio


async def test_validation_errors_use_standard_envelope(client):
    response = await client.post(
        "/api/v1/auth/login",
        json={"employee_code": "", "password": ""},
    )

    assert response.status_code == 422
    body = response.json()
    assert body["success"] is False
    assert body["message"] == "Validation failed"
    assert body["error"]["type"] == "RequestValidationError"
    assert body["error"]["code"] == "VALIDATION_ERROR"
    assert isinstance(body["details"], list)


async def test_development_docs_and_openapi_are_available_on_localhost(client):
    docs = await client.get("/docs")
    assert docs.status_code == 200

    root_openapi = await client.get("/openapi.json")
    assert root_openapi.status_code == 200
    assert root_openapi.json()["info"]["title"]

    versioned_openapi = await client.get("/api/v1/openapi.json")
    assert versioned_openapi.status_code == 200
    assert versioned_openapi.json()["paths"]


async def test_trusted_hosts_are_environment_aware():
    dev = Settings(
        ENVIRONMENT=Environment.DEVELOPMENT,
        TRUSTED_HOSTS="erp.example.com",
    )
    assert dev.trusted_hosts == ["*"]

    prod = Settings(
        ENVIRONMENT=Environment.PRODUCTION,
        SECRET_KEY="production-secret-key-with-at-least-32-chars",
        CORS_ORIGINS="https://erp.example.com",
        TRUSTED_HOSTS="erp.example.com",
        INVOICE_PUBLIC_BASE_URL="https://erp.example.com",
    )
    assert prod.trusted_hosts == ["erp.example.com"]


def production_settings(**overrides):
    values = {
        "ENVIRONMENT": Environment.PRODUCTION,
        "SECRET_KEY": "production-secret-key-with-at-least-32-chars",
        "CORS_ORIGINS": "https://erp.example.com",
        "TRUSTED_HOSTS": "erp.example.com",
        "INVOICE_PUBLIC_BASE_URL": "https://erp.example.com",
    }
    values.update(overrides)
    return Settings(**values)


async def test_invoice_public_base_url_development_default():
    settings = Settings(ENVIRONMENT=Environment.DEVELOPMENT)
    assert settings.public_frontend_base_url() == "http://localhost:5173"


async def test_invoice_public_base_url_uses_public_request_origin_as_fallback():
    settings = Settings(ENVIRONMENT=Environment.DEVELOPMENT, INVOICE_PUBLIC_BASE_URL="")
    assert settings.public_frontend_base_url("https://erp-pos.vee-gpt.com") == "https://erp-pos.vee-gpt.com"


async def test_invoice_public_base_url_ignores_local_or_internal_request_origin():
    settings = Settings(ENVIRONMENT=Environment.DEVELOPMENT, INVOICE_PUBLIC_BASE_URL="")
    assert settings.public_frontend_base_url("http://localhost:5173") == "http://localhost:5173"
    assert settings.public_frontend_base_url("http://192.168.1.20:5173") == "http://localhost:5173"


async def test_invoice_public_base_url_production_and_staging():
    prod = production_settings(INVOICE_PUBLIC_BASE_URL="https://erp.example.com")
    assert prod.public_frontend_base_url() == "https://erp.example.com"

    staging = Settings(
        ENVIRONMENT=Environment.STAGING,
        SECRET_KEY="staging-secret-key-with-at-least-32-chars",
        CORS_ORIGINS="https://staging.example.com",
        TRUSTED_HOSTS="staging.example.com",
        INVOICE_PUBLIC_BASE_URL="https://staging.example.com",
    )
    assert staging.public_frontend_base_url() == "https://staging.example.com"


async def test_invoice_public_base_url_missing_config_fails_in_production():
    with pytest.raises(ValidationError) as exc:
        production_settings(INVOICE_PUBLIC_BASE_URL="")
    assert "INVOICE_PUBLIC_BASE_URL is required" in str(exc.value)


async def test_invoice_public_base_url_invalid_config_fails():
    with pytest.raises(ValidationError) as exc:
        production_settings(INVOICE_PUBLIC_BASE_URL="not-a-url")
    assert "absolute http(s) URL" in str(exc.value)


async def test_invoice_public_base_url_requires_https_in_deployed_environments():
    with pytest.raises(ValidationError) as exc:
        production_settings(INVOICE_PUBLIC_BASE_URL="http://erp.example.com")
    assert "https://" in str(exc.value)


async def test_invoice_public_base_url_rejects_internal_hosts_in_production():
    for value in ("https://localhost:5173", "https://10.0.0.5", "https://pos-backend"):
        with pytest.raises(ValidationError):
            production_settings(INVOICE_PUBLIC_BASE_URL=value)


async def test_media_url_generation_keeps_media_mount_in_local_and_production():
    local = Settings(ENVIRONMENT=Environment.DEVELOPMENT, MEDIA_BASE_URL="auto")
    assert local.media_url_for(path="return-evidence/1/photo.png") == "/media/return-evidence/1/photo.png"
    assert local.media_url_for(path="/media/return-evidence/1/photo.png") == "/media/return-evidence/1/photo.png"

    prod_origin = production_settings(MEDIA_BASE_URL="https://erp.example.com")
    assert (
        prod_origin.media_url_for(path="return-evidence/1/photo.png")
        == "https://erp.example.com/media/return-evidence/1/photo.png"
    )

    prod_media_root = production_settings(MEDIA_BASE_URL="https://erp.example.com/media")
    assert (
        prod_media_root.media_url_for(path="return-evidence/1/photo.png")
        == "https://erp.example.com/media/return-evidence/1/photo.png"
    )


async def test_login_errors_are_specific_without_raw_details(client):
    bad_code = await client.post(
        "/api/v1/auth/login",
        json={"employee_code": "NOPE", "password": "anything"},
    )
    assert bad_code.status_code == 401
    bad_code_body = bad_code.json()
    assert bad_code_body["error"]["code"] == "INVALID_EMPLOYEE_CODE"
    assert bad_code_body["error"]["message"] == "Incorrect Employee Code"

    bad_password = await client.post(
        "/api/v1/auth/login",
        json={"employee_code": "SP001", "password": "wrong"},
    )
    assert bad_password.status_code == 401
    bad_password_body = bad_password.json()
    assert bad_password_body["error"]["code"] == "INVALID_PASSWORD"
    assert bad_password_body["error"]["message"] == "Incorrect Password"


async def test_refresh_token_rotation_rejects_replay(client):
    login = await client.post(
        "/api/v1/auth/login",
        json={"employee_code": "SP001", "password": "sp123"},
    )
    assert login.status_code == 200, login.text
    refresh_token = login.json()["refresh_token"]

    first_refresh = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert first_refresh.status_code == 200, first_refresh.text

    replay = await client.post(
        "/api/v1/auth/refresh",
        json={"refresh_token": refresh_token},
    )
    assert replay.status_code == 401
    assert replay.json()["success"] is False


async def test_password_reset_requires_body_and_is_documented_in_openapi(client):
    sm = await login(client, "SM001", "sm123")

    query_password = await client.post(
        "/api/v1/staff/3/reset-password",
        headers=sm,
        params={"new_password": "Secret@123"},
    )
    assert query_password.status_code == 422

    weak_body = await client.post(
        "/api/v1/staff/3/reset-password",
        headers=sm,
        json={"new_password": "weakpass"},
    )
    assert weak_body.status_code == 422

    body_password = await client.post(
        "/api/v1/staff/3/reset-password",
        headers=sm,
        json={"new_password": "Reset@123"},
    )
    assert body_password.status_code == 200, body_password.text

    schema = (await client.get("/api/v1/openapi.json")).json()
    operation = schema["paths"]["/api/v1/staff/{staff_id}/reset-password"]["post"]
    assert "requestBody" in operation
    assert all(
        parameter["name"] != "new_password"
        for parameter in operation.get("parameters", [])
    )
