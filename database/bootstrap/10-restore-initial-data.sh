#!/bin/sh
set -eu

backup_file="/docker-entrypoint-initdb.d/erp-pos-initial-data.backup"

if [ ! -f "$backup_file" ]; then
  echo "Initial data backup not present; continuing with an empty database."
  exit 0
fi

echo "Restoring the repository initial ERP/POS data snapshot..."
pg_restore \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --no-owner \
  --no-privileges \
  "$backup_file"
echo "Initial ERP/POS data snapshot restored."
