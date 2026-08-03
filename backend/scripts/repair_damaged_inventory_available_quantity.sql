-- Repair damaged inventory rows where quantity exists but is not represented
-- in either available_quantity or returned_to_supplier_quantity.
--
-- Expected invariant:
--   quantity = available_quantity + returned_to_supplier_quantity
--
-- This repair only fills missing available quantity when the tracked total is
-- lower than the original damaged quantity.

BEGIN;

UPDATE damaged_inventory
SET
    available_quantity = GREATEST(quantity - returned_to_supplier_quantity, 0),
    updated_at = NOW()
WHERE quantity > COALESCE(available_quantity, 0) + COALESCE(returned_to_supplier_quantity, 0);

COMMIT;
