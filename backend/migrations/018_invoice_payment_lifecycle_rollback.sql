BEGIN;

DROP TABLE IF EXISTS invoice_payments;
DROP INDEX IF EXISTS ix_invoices_payment_status;
ALTER TABLE invoices DROP COLUMN IF EXISTS last_payment_date;
ALTER TABLE invoices DROP COLUMN IF EXISTS payment_status;
ALTER TABLE invoices DROP COLUMN IF EXISTS payment_percentage;
ALTER TABLE invoices DROP COLUMN IF EXISTS remaining_amount;
ALTER TABLE invoices DROP COLUMN IF EXISTS paid_amount;

COMMIT;
