ALTER TABLE audit_logs
ADD COLUMN IF NOT EXISTS business_profile_id INTEGER REFERENCES business_profiles(id);

CREATE INDEX IF NOT EXISTS ix_audit_logs_business_created
    ON audit_logs (business_profile_id, created_at DESC, id DESC);
