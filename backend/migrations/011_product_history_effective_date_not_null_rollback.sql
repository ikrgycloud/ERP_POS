ALTER TABLE product_prices
    ALTER COLUMN effective_date DROP NOT NULL;

ALTER TABLE product_qualities
    ALTER COLUMN effective_date DROP NOT NULL;

ALTER TABLE product_quantities
    ALTER COLUMN effective_date DROP NOT NULL;
