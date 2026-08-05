# ERP + POS Docker deployment

This repository ships a single Docker Compose stack for the full shared platform:

- PostgreSQL with persistent storage and optional first-run bootstrap data
- a POS migration job and an ERP migration job, both targeting the same database
- the POS FastAPI backend and ERP FastAPI backend
- the POS web app and ERP web app, each proxying API traffic to its own backend on one public origin

## Start

1. Create the runtime environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Update at least these secrets before first start:

   - `POSTGRES_PASSWORD`
   - `REGISTER_KEY`
   - `JWT_SECRET_KEY`
   - `SECRET_KEY`
   - `POS_SECRET_KEY`

3. For local access the defaults expose:

   - ERP web on `http://localhost:8080`
   - POS web on `http://localhost:8081`

4. For a public deployment also set the real domains and tighten:

   - `ERP_PUBLIC_BASE_URL`
   - `POS_INVOICE_PUBLIC_BASE_URL`
   - `ERP_CORS_ORIGINS`, `POS_CORS_ORIGINS`
   - `ERP_TRUSTED_HOSTS`, `POS_TRUSTED_HOSTS`

5. Build and start the stack:

   ```powershell
   docker compose up -d --build
   ```

The one-shot migration containers exit successfully after schema setup; that is expected.

## Operations

```powershell
# Follow startup and migration logs
docker compose logs -f db pos-migrate erp-migrate pos-backend erp-backend pos-web erp-web

# Apply migrations after pulling a new release
docker compose up -d --build

# Show container health and status
docker compose ps

# Stop containers while keeping database, uploads, and logs
docker compose down
```

The named volumes retain database data, ERP uploads/logs, and POS uploads/logs. Do not use `docker compose down --volumes` unless you intentionally want to permanently delete all ERP/POS operational data.

## Database access

PostgreSQL is intentionally internal-only. Run a client inside the database container when needed:

```powershell
docker compose exec db sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

If you need a host port for local development, add a temporary `ports` entry under the `db` service, such as `"5432:5432"`; do not expose it on a public server.

## Schema and data initialization

On a brand-new database volume, PostgreSQL also restores the repository snapshot from [database/bootstrap/erp-pos-initial-data.backup](/D:/ERP_POS/database/bootstrap/erp-pos-initial-data.backup) before migrations run.

Each `docker compose up` then runs:

- POS Alembic migrations with `alembic upgrade head`
- ERP migrations with `python scripts/run_migrations.py`

The application containers only start after their migration dependencies succeed, so startup is deterministic from a fresh clone and after upgrades.
