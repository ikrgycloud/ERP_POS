# Initial ERP/POS database data

`erp-pos-initial-data.backup` is the approved initial PostgreSQL data snapshot for this private repository.

Docker restores it automatically only when `erp_postgres_data` is created for the first time. The normal ERP and POS migration services then bring the schema to the current version.

## Expected behavior

| Action | Result |
| --- | --- |
| `docker compose up -d --build` on a new clone | Creates the database volume and restores this snapshot. |
| `docker compose down` then `docker compose up -d --build` | Reuses the current volume; data is unchanged. |
| `docker compose down -v` then `docker compose up -d --build` | Deletes the database volume, then creates it again and restores this snapshot. |

## Updating the committed snapshot

Create a new backup from the running shared database and replace `erp-pos-initial-data.backup`. Review the data carefully before committing: this is a private-repository data file and will be available to every repository collaborator.

```powershell
docker compose exec -T db sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > database/bootstrap/erp-pos-initial-data.backup
```

Do not put `.env` files, passwords, or unrelated local backups in this folder.
