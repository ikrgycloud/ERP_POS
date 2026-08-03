DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inventory_ledger_type') THEN
        ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'SUPPLIER_RETURN';
        ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'SUPPLIER_REPLACEMENT';
        ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'SUPPLIER_REJECT';
        ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'SUPPLIER_CREDIT';
        ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'SCRAP';
        ALTER TYPE inventory_ledger_type ADD VALUE IF NOT EXISTS 'REPAIR';
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_name = 'inventory_ledger'
          AND column_name = 'type'
          AND data_type = 'character varying'
          AND character_maximum_length IS NOT NULL
          AND character_maximum_length < 40
    ) THEN
        ALTER TABLE inventory_ledger
            ALTER COLUMN type TYPE VARCHAR(40);
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS workflow_statuses (
    id SERIAL PRIMARY KEY,
    business_profile_id INTEGER REFERENCES business_profiles(id) ON DELETE CASCADE,
    module VARCHAR(80) NOT NULL,
    code VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    sequence INTEGER NOT NULL DEFAULT 0,
    is_initial BOOLEAN NOT NULL DEFAULT FALSE,
    is_terminal BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    allowed_next JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_workflow_statuses_business_module_code UNIQUE (business_profile_id, module, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_workflow_statuses_global_module_code
    ON workflow_statuses (module, code)
    WHERE business_profile_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_workflow_statuses_business_module
    ON workflow_statuses (business_profile_id, module, is_active, sequence);

CREATE TABLE IF NOT EXISTS approval_levels (
    id SERIAL PRIMARY KEY,
    business_profile_id INTEGER REFERENCES business_profiles(id) ON DELETE CASCADE,
    module VARCHAR(80) NOT NULL,
    workflow_status_id INTEGER REFERENCES workflow_statuses(id),
    level_order INTEGER NOT NULL,
    role_code VARCHAR(80) NOT NULL,
    approver_staff_id INTEGER REFERENCES staff(id),
    required_approvals INTEGER NOT NULL DEFAULT 1,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_approval_levels_positive_order CHECK (level_order > 0),
    CONSTRAINT ck_approval_levels_required_positive CHECK (required_approvals > 0),
    CONSTRAINT uq_approval_levels_business_module_order UNIQUE (business_profile_id, module, level_order)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_approval_levels_global_module_order
    ON approval_levels (module, level_order)
    WHERE business_profile_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_approval_levels_business_module
    ON approval_levels (business_profile_id, module, is_active, level_order);

CREATE TABLE IF NOT EXISTS damage_categories (
    id SERIAL PRIMARY KEY,
    business_profile_id INTEGER REFERENCES business_profiles(id) ON DELETE CASCADE,
    code VARCHAR(80) NOT NULL,
    label VARCHAR(160) NOT NULL,
    default_decision VARCHAR(80) NOT NULL,
    requires_supplier_return BOOLEAN NOT NULL DEFAULT FALSE,
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_damage_categories_business_code UNIQUE (business_profile_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_damage_categories_global_code
    ON damage_categories (code)
    WHERE business_profile_id IS NULL;
CREATE INDEX IF NOT EXISTS ix_damage_categories_business_active
    ON damage_categories (business_profile_id, is_active, label);

ALTER TABLE damaged_inventory
    ADD COLUMN IF NOT EXISTS available_quantity NUMERIC(12, 3),
    ADD COLUMN IF NOT EXISTS inspected_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS returned_to_supplier_quantity NUMERIC(12, 3) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS inspection_status VARCHAR(60) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS current_workflow_status_id INTEGER REFERENCES workflow_statuses(id),
    ADD COLUMN IF NOT EXISTS lot_number VARCHAR(80),
    ADD COLUMN IF NOT EXISTS expiry_date DATE,
    ADD COLUMN IF NOT EXISTS purchase_reference_id INTEGER REFERENCES orders(id),
    ADD COLUMN IF NOT EXISTS updated_by_staff_id INTEGER REFERENCES staff(id),
    ADD COLUMN IF NOT EXISTS photos JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

UPDATE damaged_inventory
SET available_quantity = quantity
WHERE available_quantity IS NULL;

ALTER TABLE damaged_inventory
    ALTER COLUMN available_quantity SET DEFAULT 0,
    ALTER COLUMN available_quantity SET NOT NULL;

CREATE INDEX IF NOT EXISTS ix_damaged_inventory_business_status
    ON damaged_inventory (business_profile_id, inspection_status, disposition);
CREATE INDEX IF NOT EXISTS ix_damaged_inventory_product_available
    ON damaged_inventory (product_id, available_quantity);
CREATE INDEX IF NOT EXISTS ix_damaged_inventory_workflow_status
    ON damaged_inventory (current_workflow_status_id);

CREATE TABLE IF NOT EXISTS inspection_reports (
    id SERIAL PRIMARY KEY,
    business_profile_id INTEGER REFERENCES business_profiles(id) ON DELETE CASCADE,
    damaged_inventory_id INTEGER NOT NULL REFERENCES damaged_inventory(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    return_id INTEGER REFERENCES returns(id),
    return_item_id INTEGER REFERENCES return_items(id),
    inspected_by_staff_id INTEGER REFERENCES staff(id),
    inspected_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    inspected_quantity NUMERIC(12, 3) NOT NULL,
    outcome VARCHAR(80) NOT NULL,
    decision VARCHAR(80) NOT NULL,
    reason TEXT,
    remarks TEXT,
    photos JSONB NOT NULL DEFAULT '[]'::jsonb,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_inspection_reports_quantity_positive CHECK (inspected_quantity > 0)
);

CREATE INDEX IF NOT EXISTS ix_inspection_reports_business_date
    ON inspection_reports (business_profile_id, inspected_at DESC);
CREATE INDEX IF NOT EXISTS ix_inspection_reports_damaged_inventory
    ON inspection_reports (damaged_inventory_id);
CREATE INDEX IF NOT EXISTS ix_inspection_reports_product
    ON inspection_reports (product_id);
CREATE INDEX IF NOT EXISTS ix_inspection_reports_decision
    ON inspection_reports (decision);

CREATE TABLE IF NOT EXISTS supplier_returns (
    id SERIAL PRIMARY KEY,
    business_profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    outlet_id INTEGER REFERENCES outlets(id),
    rtv_number VARCHAR(60) NOT NULL,
    purchase_order_id INTEGER REFERENCES orders(id),
    purchase_invoice_id INTEGER REFERENCES invoices(id),
    current_status_id INTEGER REFERENCES workflow_statuses(id),
    approval_status VARCHAR(40) NOT NULL DEFAULT 'pending',
    shipment_status VARCHAR(40) NOT NULL DEFAULT 'not_ready',
    replacement_status VARCHAR(40) NOT NULL DEFAULT 'not_expected',
    credit_status VARCHAR(40) NOT NULL DEFAULT 'not_expected',
    created_by_staff_id INTEGER REFERENCES staff(id),
    submitted_at TIMESTAMPTZ,
    closed_at TIMESTAMPTZ,
    reason TEXT,
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT uq_supplier_returns_business_rtv_number UNIQUE (business_profile_id, rtv_number)
);

CREATE INDEX IF NOT EXISTS ix_supplier_returns_business_status
    ON supplier_returns (business_profile_id, current_status_id, approval_status, shipment_status);
CREATE INDEX IF NOT EXISTS ix_supplier_returns_supplier
    ON supplier_returns (supplier_id, created_at DESC);
CREATE INDEX IF NOT EXISTS ix_supplier_returns_outlet
    ON supplier_returns (outlet_id, created_at DESC);

CREATE TABLE IF NOT EXISTS supplier_return_items (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    business_profile_id INTEGER NOT NULL REFERENCES business_profiles(id) ON DELETE CASCADE,
    damaged_inventory_id INTEGER NOT NULL REFERENCES damaged_inventory(id),
    inspection_report_id INTEGER REFERENCES inspection_reports(id),
    product_id INTEGER NOT NULL REFERENCES products(id),
    return_id INTEGER REFERENCES returns(id),
    return_item_id INTEGER REFERENCES return_items(id),
    current_status_id INTEGER REFERENCES workflow_statuses(id),
    quantity_requested NUMERIC(12, 3) NOT NULL,
    quantity_approved NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_shipped NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_supplier_received NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_supplier_accepted NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_supplier_rejected NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_replaced NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_credited NUMERIC(12, 3) NOT NULL DEFAULT 0,
    quantity_refunded NUMERIC(12, 3) NOT NULL DEFAULT 0,
    unit_cost NUMERIC(12, 2),
    reason TEXT,
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_supplier_return_items_requested_positive CHECK (quantity_requested > 0),
    CONSTRAINT ck_supplier_return_items_non_negative CHECK (
        quantity_approved >= 0
        AND quantity_shipped >= 0
        AND quantity_supplier_received >= 0
        AND quantity_supplier_accepted >= 0
        AND quantity_supplier_rejected >= 0
        AND quantity_replaced >= 0
        AND quantity_credited >= 0
        AND quantity_refunded >= 0
    ),
    CONSTRAINT ck_supplier_return_items_quantity_bounds CHECK (
        quantity_approved <= quantity_requested
        AND quantity_shipped <= quantity_approved
        AND quantity_supplier_received <= quantity_shipped
        AND quantity_supplier_accepted + quantity_supplier_rejected <= quantity_supplier_received
        AND quantity_replaced + quantity_credited + quantity_refunded <= quantity_supplier_accepted
    )
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_items_return
    ON supplier_return_items (supplier_return_id);
CREATE INDEX IF NOT EXISTS ix_supplier_return_items_business_status
    ON supplier_return_items (business_profile_id, current_status_id);
CREATE INDEX IF NOT EXISTS ix_supplier_return_items_product
    ON supplier_return_items (product_id);
CREATE INDEX IF NOT EXISTS ix_supplier_return_items_damaged_inventory
    ON supplier_return_items (damaged_inventory_id);

CREATE TABLE IF NOT EXISTS supplier_return_status_history (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_return_item_id INTEGER REFERENCES supplier_return_items(id) ON DELETE CASCADE,
    old_status_id INTEGER REFERENCES workflow_statuses(id),
    new_status_id INTEGER REFERENCES workflow_statuses(id),
    action VARCHAR(80) NOT NULL,
    changed_by_staff_id INTEGER REFERENCES staff(id),
    changed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_status_history_return
    ON supplier_return_status_history (supplier_return_id, changed_at DESC);
CREATE INDEX IF NOT EXISTS ix_supplier_return_status_history_item
    ON supplier_return_status_history (supplier_return_item_id, changed_at DESC);

CREATE TABLE IF NOT EXISTS supplier_return_approval_history (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_return_item_id INTEGER REFERENCES supplier_return_items(id) ON DELETE CASCADE,
    approval_level_id INTEGER REFERENCES approval_levels(id),
    approver_staff_id INTEGER REFERENCES staff(id),
    decision VARCHAR(40) NOT NULL,
    decided_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_approval_history_return
    ON supplier_return_approval_history (supplier_return_id, decided_at DESC);
CREATE INDEX IF NOT EXISTS ix_supplier_return_approval_history_level
    ON supplier_return_approval_history (approval_level_id, decision);

CREATE TABLE IF NOT EXISTS supplier_return_shipments (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    carrier_name VARCHAR(160),
    transport_mode VARCHAR(80),
    tracking_number VARCHAR(120),
    vehicle_number VARCHAR(80),
    driver_name VARCHAR(120),
    driver_phone VARCHAR(40),
    shipment_date TIMESTAMPTZ,
    expected_delivery_at TIMESTAMPTZ,
    actual_delivery_at TIMESTAMPTZ,
    status VARCHAR(60) NOT NULL DEFAULT 'draft',
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_shipments_return
    ON supplier_return_shipments (supplier_return_id);
CREATE INDEX IF NOT EXISTS ix_supplier_return_shipments_tracking
    ON supplier_return_shipments (tracking_number);

CREATE TABLE IF NOT EXISTS supplier_return_documents (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_return_item_id INTEGER REFERENCES supplier_return_items(id) ON DELETE CASCADE,
    document_type VARCHAR(80) NOT NULL,
    document_number VARCHAR(120),
    file_url VARCHAR(500),
    file_path VARCHAR(500),
    uploaded_by_staff_id INTEGER REFERENCES staff(id),
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_documents_return
    ON supplier_return_documents (supplier_return_id, document_type);

CREATE TABLE IF NOT EXISTS supplier_return_responses (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_return_item_id INTEGER NOT NULL REFERENCES supplier_return_items(id) ON DELETE CASCADE,
    response_type VARCHAR(60) NOT NULL,
    quantity NUMERIC(12, 3) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    supplier_reference VARCHAR(120),
    responded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    recorded_by_staff_id INTEGER REFERENCES staff(id),
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_supplier_return_responses_quantity_positive CHECK (quantity > 0),
    CONSTRAINT ck_supplier_return_responses_amount_non_negative CHECK (amount >= 0)
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_responses_item
    ON supplier_return_responses (supplier_return_item_id, responded_at DESC);
CREATE INDEX IF NOT EXISTS ix_supplier_return_responses_type
    ON supplier_return_responses (response_type);

CREATE TABLE IF NOT EXISTS supplier_return_replacements (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_return_item_id INTEGER NOT NULL REFERENCES supplier_return_items(id) ON DELETE CASCADE,
    product_id INTEGER NOT NULL REFERENCES products(id),
    replacement_product_id INTEGER REFERENCES products(id),
    quantity NUMERIC(12, 3) NOT NULL,
    received_at TIMESTAMPTZ,
    invoice_id INTEGER REFERENCES invoices(id),
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_supplier_return_replacements_quantity_positive CHECK (quantity > 0)
);

CREATE INDEX IF NOT EXISTS ix_supplier_return_replacements_item
    ON supplier_return_replacements (supplier_return_item_id);

CREATE TABLE IF NOT EXISTS supplier_return_credit_notes (
    id SERIAL PRIMARY KEY,
    supplier_return_id INTEGER NOT NULL REFERENCES supplier_returns(id) ON DELETE CASCADE,
    supplier_return_item_id INTEGER REFERENCES supplier_return_items(id) ON DELETE CASCADE,
    supplier_id INTEGER NOT NULL REFERENCES suppliers(id),
    credit_note_number VARCHAR(120) NOT NULL,
    amount NUMERIC(12, 2) NOT NULL,
    tax_amount NUMERIC(12, 2) NOT NULL DEFAULT 0,
    issued_at TIMESTAMPTZ,
    status VARCHAR(40) NOT NULL DEFAULT 'pending',
    invoice_id INTEGER REFERENCES invoices(id),
    remarks TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT ck_supplier_return_credit_notes_amount_non_negative CHECK (amount >= 0 AND tax_amount >= 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_supplier_return_credit_notes_supplier_number
    ON supplier_return_credit_notes (supplier_id, credit_note_number);
CREATE INDEX IF NOT EXISTS ix_supplier_return_credit_notes_return
    ON supplier_return_credit_notes (supplier_return_id, status);

INSERT INTO workflow_statuses (module, code, label, sequence, is_initial, is_terminal, allowed_next)
VALUES
    ('supplier_return', 'draft', 'Draft', 10, TRUE, FALSE, '["pending_approval","cancelled"]'::jsonb),
    ('supplier_return', 'pending_approval', 'Pending Approval', 20, FALSE, FALSE, '["approved","rejected","cancelled"]'::jsonb),
    ('supplier_return', 'approved', 'Approved', 30, FALSE, FALSE, '["ready_for_shipment","cancelled"]'::jsonb),
    ('supplier_return', 'ready_for_shipment', 'Ready For Shipment', 40, FALSE, FALSE, '["shipped","cancelled"]'::jsonb),
    ('supplier_return', 'shipped', 'Shipped', 50, FALSE, FALSE, '["supplier_received"]'::jsonb),
    ('supplier_return', 'supplier_received', 'Supplier Received', 60, FALSE, FALSE, '["supplier_inspection"]'::jsonb),
    ('supplier_return', 'supplier_inspection', 'Supplier Inspection', 70, FALSE, FALSE, '["replacement_pending","credit_pending","refund_issued","rejected","closed"]'::jsonb),
    ('supplier_return', 'replacement_pending', 'Replacement Pending', 80, FALSE, FALSE, '["replacement_received","closed"]'::jsonb),
    ('supplier_return', 'replacement_received', 'Replacement Received', 90, FALSE, FALSE, '["closed"]'::jsonb),
    ('supplier_return', 'credit_pending', 'Credit Pending', 100, FALSE, FALSE, '["credit_issued","closed"]'::jsonb),
    ('supplier_return', 'credit_issued', 'Credit Issued', 110, FALSE, FALSE, '["closed"]'::jsonb),
    ('supplier_return', 'refund_issued', 'Refund Issued', 120, FALSE, FALSE, '["closed"]'::jsonb),
    ('supplier_return', 'rejected', 'Rejected', 130, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return', 'cancelled', 'Cancelled', 140, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return', 'closed', 'Closed', 150, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return_item', 'pending_inspection', 'Pending Inspection', 10, TRUE, FALSE, '["inspection_completed"]'::jsonb),
    ('supplier_return_item', 'inspection_completed', 'Inspection Completed', 20, FALSE, FALSE, '["pending_approval","returned_to_shelf","repaired","scrapped"]'::jsonb),
    ('supplier_return_item', 'pending_approval', 'Pending Approval', 30, FALSE, FALSE, '["approved","rejected"]'::jsonb),
    ('supplier_return_item', 'approved', 'Approved', 40, FALSE, FALSE, '["ready_for_shipment"]'::jsonb),
    ('supplier_return_item', 'ready_for_shipment', 'Ready For Shipment', 50, FALSE, FALSE, '["shipped"]'::jsonb),
    ('supplier_return_item', 'shipped', 'Shipped', 60, FALSE, FALSE, '["supplier_received"]'::jsonb),
    ('supplier_return_item', 'supplier_received', 'Supplier Received', 70, FALSE, FALSE, '["supplier_inspection"]'::jsonb),
    ('supplier_return_item', 'supplier_inspection', 'Supplier Inspection', 80, FALSE, FALSE, '["replacement_pending","replacement_received","credit_issued","refund_issued","rejected","closed"]'::jsonb),
    ('supplier_return_item', 'replacement_pending', 'Replacement Pending', 90, FALSE, FALSE, '["replacement_received","closed"]'::jsonb),
    ('supplier_return_item', 'replacement_received', 'Replacement Received', 100, FALSE, FALSE, '["closed"]'::jsonb),
    ('supplier_return_item', 'credit_pending', 'Credit Pending', 110, FALSE, FALSE, '["credit_issued","closed"]'::jsonb),
    ('supplier_return_item', 'credit_issued', 'Credit Issued', 120, FALSE, FALSE, '["closed"]'::jsonb),
    ('supplier_return_item', 'refund_issued', 'Refund Issued', 130, FALSE, FALSE, '["closed"]'::jsonb),
    ('supplier_return_item', 'returned_to_shelf', 'Returned To Shelf', 140, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return_item', 'repaired', 'Repaired', 150, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return_item', 'scrapped', 'Scrapped', 160, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return_item', 'rejected', 'Rejected', 170, FALSE, TRUE, '[]'::jsonb),
    ('supplier_return_item', 'closed', 'Closed', 200, FALSE, TRUE, '[]'::jsonb)
ON CONFLICT DO NOTHING;

INSERT INTO damage_categories (code, label, default_decision, requires_supplier_return)
VALUES
    ('good_condition', 'Good Condition', 'return_to_shelf', FALSE),
    ('damaged', 'Damaged', 'return_to_supplier', TRUE),
    ('manufacturing_defect', 'Manufacturing Defect', 'return_to_supplier', TRUE),
    ('expired', 'Expired', 'return_to_supplier', TRUE),
    ('packaging_damage', 'Packaging Damage', 'return_to_supplier', TRUE),
    ('broken', 'Broken', 'scrap', FALSE),
    ('customer_misuse', 'Customer Misuse', 'scrap', FALSE),
    ('repairable', 'Repairable', 'repair', FALSE),
    ('non_repairable', 'Non Repairable', 'scrap', FALSE)
ON CONFLICT DO NOTHING;
