UPDATE product_quantities
SET effective_date = COALESCE(created_at::date, CURRENT_DATE)
WHERE effective_date IS NULL;

ALTER TABLE product_quantities
    ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE,
    ALTER COLUMN effective_date SET NOT NULL;

UPDATE product_qualities
SET effective_date = COALESCE(created_at::date, CURRENT_DATE)
WHERE effective_date IS NULL;

ALTER TABLE product_qualities
    ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE,
    ALTER COLUMN effective_date SET NOT NULL;

UPDATE product_prices
SET effective_date = COALESCE(created_at::date, CURRENT_DATE)
WHERE effective_date IS NULL;

ALTER TABLE product_prices
    ALTER COLUMN effective_date SET DEFAULT CURRENT_DATE,
    ALTER COLUMN effective_date SET NOT NULL;
