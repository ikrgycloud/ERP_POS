BEGIN;

ALTER TABLE invoices ADD COLUMN IF NOT EXISTS paid_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS remaining_amount NUMERIC(12, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_percentage NUMERIC(7, 2) NOT NULL DEFAULT 0;
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS payment_status VARCHAR(30) NOT NULL DEFAULT 'Unpaid';
ALTER TABLE invoices ADD COLUMN IF NOT EXISTS last_payment_date TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS invoice_payments (
    id SERIAL PRIMARY KEY,
    receipt_number VARCHAR(50) NOT NULL UNIQUE,
    invoice_id INTEGER NOT NULL REFERENCES invoices(id),
    business_profile_id INTEGER REFERENCES business_profiles(id),
    customer_id INTEGER REFERENCES customers(id),
    outlet_id INTEGER REFERENCES outlets(id),
    reversal_of_id INTEGER UNIQUE REFERENCES invoice_payments(id),
    amount NUMERIC(12, 2) NOT NULL CHECK (amount > 0),
    payment_method VARCHAR(40) NOT NULL,
    transaction_reference VARCHAR(120),
    transaction_type VARCHAR(30) NOT NULL DEFAULT 'payment',
    status VARCHAR(30) NOT NULL DEFAULT 'successful',
    notes TEXT,
    received_by VARCHAR(160),
    paid_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    reversed_at TIMESTAMPTZ,
    invoice_total_snapshot NUMERIC(12, 2) NOT NULL,
    previous_paid_amount NUMERIC(12, 2) NOT NULL,
    total_paid_after NUMERIC(12, 2) NOT NULL,
    remaining_after NUMERIC(12, 2) NOT NULL,
    payment_status_after VARCHAR(30) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT ck_invoice_payment_status CHECK (status IN ('successful', 'pending', 'failed', 'reversed')),
    CONSTRAINT ck_invoice_payment_type CHECK (transaction_type IN ('payment', 'refund', 'credit_adjustment', 'debit_adjustment', 'reversal')),
    CONSTRAINT uq_invoice_payment_receipt_tenant UNIQUE (business_profile_id, receipt_number)
);

CREATE INDEX IF NOT EXISTS ix_invoice_payments_invoice_paid_at ON invoice_payments(invoice_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS ix_invoice_payments_tenant ON invoice_payments(business_profile_id);
CREATE INDEX IF NOT EXISTS ix_invoice_payments_customer ON invoice_payments(customer_id);
CREATE INDEX IF NOT EXISTS ix_invoice_payments_outlet ON invoice_payments(outlet_id);
CREATE INDEX IF NOT EXISTS ix_invoice_payments_reference ON invoice_payments(transaction_reference);
CREATE INDEX IF NOT EXISTS ix_invoices_payment_status ON invoices(payment_status);

UPDATE invoices
SET remaining_amount = taxable_value + cgst + sgst + igst
WHERE remaining_amount = 0 AND paid_amount = 0;

COMMIT;
