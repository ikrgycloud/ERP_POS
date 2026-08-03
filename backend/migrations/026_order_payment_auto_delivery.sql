-- Keep a record of orders delivered automatically after their customer invoice is fully paid.
ALTER TABLE orders
    ADD COLUMN IF NOT EXISTS payment_auto_delivered BOOLEAN NOT NULL DEFAULT FALSE;
