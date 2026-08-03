-- Notification history now records invoices, orders, and supplier returns.
-- The legacy table required an invoice reference, which prevents the generic
-- event record from being persisted and rolls back the notification worker.

ALTER TABLE notification_history
    ALTER COLUMN invoice_id DROP NOT NULL;
