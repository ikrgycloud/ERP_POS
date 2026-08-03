BEGIN;

ALTER TABLE suppliers ADD COLUMN IF NOT EXISTS phone VARCHAR(30);

UPDATE suppliers
SET phone = mobile
WHERE (phone IS NULL OR BTRIM(phone) = '')
  AND mobile IS NOT NULL
  AND BTRIM(mobile) <> '';

UPDATE suppliers
SET mobile = phone
WHERE (mobile IS NULL OR BTRIM(mobile) = '')
  AND phone IS NOT NULL
  AND BTRIM(phone) <> '';

CREATE INDEX IF NOT EXISTS ix_suppliers_phone ON suppliers(phone);
CREATE INDEX IF NOT EXISTS ix_suppliers_business_phone ON suppliers(business_profile_id, phone);

COMMIT;
