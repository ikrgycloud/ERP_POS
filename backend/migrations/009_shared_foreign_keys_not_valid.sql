DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_business_profile_id') THEN
        ALTER TABLE products
        ADD CONSTRAINT fk_products_business_profile_id
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_category_id') THEN
        ALTER TABLE products
        ADD CONSTRAINT fk_products_category_id
        FOREIGN KEY (category_id) REFERENCES categories(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_products_supplier_id') THEN
        ALTER TABLE products
        ADD CONSTRAINT fk_products_supplier_id
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_business_profile_id') THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_business_profile_id
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_customer_id') THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_customer_id
        FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_outlet_id') THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_outlet_id
        FOREIGN KEY (outlet_id) REFERENCES outlets(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_orders_supplier_id') THEN
        ALTER TABLE orders
        ADD CONSTRAINT fk_orders_supplier_id
        FOREIGN KEY (supplier_id) REFERENCES suppliers(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_business_profile_id') THEN
        ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_business_profile_id
        FOREIGN KEY (business_profile_id) REFERENCES business_profiles(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_customer_id') THEN
        ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_customer_id
        FOREIGN KEY (customer_id) REFERENCES customers(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_linked_invoice_id') THEN
        ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_linked_invoice_id
        FOREIGN KEY (linked_invoice_id) REFERENCES invoices(id) NOT VALID;
    END IF;

    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_invoices_outlet_id') THEN
        ALTER TABLE invoices
        ADD CONSTRAINT fk_invoices_outlet_id
        FOREIGN KEY (outlet_id) REFERENCES outlets(id) NOT VALID;
    END IF;
END $$;
