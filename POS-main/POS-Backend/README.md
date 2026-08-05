# POS + ERP API

Production-ready FastAPI backend for a POS + ERP workflow. It uses FastAPI,
SQLAlchemy 2.x Async ORM, PostgreSQL, Alembic, Pydantic v2, AsyncPG, JWT,
role-based authorization, permission hooks, structured request logging, and
automatic startup database bootstrap.

## Architecture

```text
app/
  api/             routers, dependencies, pagination
  core/            config, logging, middleware, security, lifespan, exceptions
  db/              async engine, sessions, startup init, health checks
  models/          SQLAlchemy ORM: org, catalog, sales
  permissions/     role-to-permission mapping
  repositories/    persistence only: BaseRepository[T] + concrete repos
  services/        business rules: billing, returns, staff, audit, numbering
  schemas/         Pydantic v2 request/response contracts
  utils/           pure helpers
  main.py          app factory and API assembly
```

Layering rule: endpoints never touch ORM persistence directly. Request flow is
endpoint -> service -> repository -> model. Repositories own database queries;
services own business rules.

## Run It

```bash
notepad .env
# Generate a real key: openssl rand -hex 32 -> SECRET_KEY
# Set DATABASE_URL to the same PostgreSQL database used by the ERP backend.

pip install -r requirements.txt

# Optional demo data: BM001/bm123, SM001/sm123, SP001/sp123
python -m scripts.seed

uvicorn app.main:app --reload
```

Swagger UI is available at `http://localhost:8000/docs`.

## Database Bootstrap

On FastAPI lifespan startup the app:

- connects to PostgreSQL with retry logic;
- uses the existing ERP database configured by `DATABASE_URL`;
- imports all ORM models;
- creates only missing tables with `Base.metadata.create_all(checkfirst=True)`;
- adds safe POS compatibility columns to existing ERP tables when needed;
- uses PostgreSQL advisory locks around schema creation;
- disposes the async engine on shutdown.

Alembic remains configured for future schema migrations. For schema changes on
an existing database, create and apply a migration:

```bash
alembic revision --autogenerate -m "describe change"
alembic upgrade head
```

## Security

- JWT access and refresh tokens include `jti` IDs.
- Refresh tokens rotate and the previous refresh token is revoked.
- Logout revokes supplied access/refresh tokens.
- Login attempts are throttled per employee code.
- RBAC is enforced through `require_roles(...)`.
- Permission hooks are available through `require_permissions(...)`.
- CORS, trusted hosts, HTTPS redirect, security headers, and rate limits are
  configurable.

The default token revocation store is in-process. Use Redis or a database-backed
store before running multiple API workers.

## Configuration

Settings are loaded with Pydantic Settings v2 from:

- `.env`

Production mode validates that `DEBUG=false`, `SECRET_KEY` is rotated, and
wildcard CORS/trusted hosts are not used.

Key operational variables:

- `DATABASE_URL` / `ERP_DATABASE_URL` / `DATABASE_URL_OVERRIDE`
- `DB_INIT_RETRIES` / `DB_INIT_RETRY_SECONDS`
- `TRUSTED_HOSTS`
- `ENABLE_HTTPS_REDIRECT`
- `RATE_LIMIT_ENABLED`
- `RATE_LIMIT_REQUESTS`
- `RATE_LIMIT_WINDOW_SECONDS`
- `LOG_LEVEL`
- `LOG_FILE`
- `LOG_SQL`

For production SMS receipts, set these on the deployed `pos-backend` service:

- `SMS_ENABLED=true`
- `TWILIO_ACCOUNT_SID`
- `TWILIO_AUTH_TOKEN`
- `TWILIO_PHONE_NUMBER`
- `NOTIFICATION_WORKER_ENABLED=true`

If `SMS_ENABLED` is missing or false, checkout will intentionally mark SMS as
`skipped`. If Twilio credentials are missing, production compose now fails fast
instead of silently disabling receipt messages.

## Error Format

Application, validation, HTTP, and unhandled errors use the same response shape:

```json
{
  "success": false,
  "message": "Validation failed",
  "error": "RequestValidationError",
  "details": {}
}
```

## Health

`GET /health` returns process status, app version, environment, and database
availability.

## Tests

```bash
pytest -q
```

Tests use in-memory SQLite with a `get_db` dependency override. Coverage includes
RBAC denial, staff hierarchy rules, billing and reversal flow, standardized error
responses, and refresh-token replay rejection.

## Before Production

- Rotate `SECRET_KEY`.
- Set `ENVIRONMENT=production`.
- Replace wildcard `CORS_ORIGINS` and `TRUSTED_HOSTS`.
- Replace in-process token revocation and rate limiting with Redis or another
  shared backend for multi-worker deployments.
- Replace count-based document numbering with a sequence table, row lock, or
  PostgreSQL sequence to avoid concurrent checkout collisions.
- Generate Alembic migrations for index or column changes on existing databases.
