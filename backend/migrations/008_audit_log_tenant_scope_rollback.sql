DROP INDEX IF EXISTS ix_audit_logs_business_created;

ALTER TABLE audit_logs
DROP COLUMN IF EXISTS business_profile_id;
