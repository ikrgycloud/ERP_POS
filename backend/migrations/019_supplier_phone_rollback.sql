BEGIN;

DROP INDEX IF EXISTS ix_suppliers_business_phone;
DROP INDEX IF EXISTS ix_suppliers_phone;
ALTER TABLE suppliers DROP COLUMN IF EXISTS phone;

COMMIT;
