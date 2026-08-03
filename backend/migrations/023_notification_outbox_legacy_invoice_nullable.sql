-- The original notification_outbox table was invoice-only and required invoice_id.
-- The production outbox now also stores order and supplier-return events, so an
-- invoice reference must be optional. Keep existing records untouched.

ALTER TABLE notification_outbox
    ALTER COLUMN invoice_id DROP NOT NULL;
