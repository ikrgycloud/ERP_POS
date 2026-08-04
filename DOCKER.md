# ERP Docker deployment

This Compose stack runs the full ERP application:

- PostgreSQL with persistent storage
- a one-shot migration service that creates missing ORM tables and applies the versioned SQL migrations
- the FastAPI backend with persistent uploads and logs
- the web client, which proxies `/api` and `/uploads` to the backend so it works on one public URL

## Start

1. Create the runtime environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

2. Update at least `POSTGRES_PASSWORD`, `JWT_SECRET_KEY`, and `REGISTER_KEY`. For a public deployment also set `ERP_PUBLIC_BASE_URL`, `CORS_ORIGINS`, and `TRUSTED_HOSTS` to the real HTTPS domain.

3. Build and start the stack:

   ```powershell
   docker compose up -d --build
   ```

Open `http://localhost:8080` (or the value of `ERP_WEB_PORT`). The migration service exits successfully after applying new migrations; this is expected.

## Operations

```powershell
# Follow startup and migration logs
docker compose logs -f migrate backend web

# Apply migrations after pulling a new release
docker compose up -d --build

# Show container health and status
docker compose ps

# Stop containers while keeping database, uploads, and logs
docker compose down
```

The named volumes `postgres_data`, `backend_uploads`, and `backend_logs` retain operational data. Do not use `docker compose down --volumes` unless you intentionally want to permanently delete all ERP database data, uploads, and logs.

## Database access

PostgreSQL is intentionally internal-only. Run a client inside the database container when needed:

```powershell
docker compose exec db psql -U erp -d erp
```

If you need a host port for local development, add a temporary `ports` entry under the `db` service, such as `"5432:5432"`; do not expose it on a public server.

## Schema and data initialization

Every `docker compose up` waits for PostgreSQL, then runs `backend/scripts/run_migrations.py`. The script is safe to rerun: it creates missing model tables and tracks SQL migrations by filename and checksum in `schema_migrations`. The API only starts after migration completes.

This project does not include a sample-data seeder, so the stack intentionally starts with an empty ERP database. Create the first business/admin account through the application. This avoids silently inserting demo records into production data.
