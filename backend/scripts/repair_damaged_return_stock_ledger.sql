-- Damaged customer returns must not re-enter sellable stock.
--
-- Older return ledgers stored RETURN +quantity even when the return item was
-- routed into damaged_inventory. That made later ledger recalculation overstate
-- products.stock_cached. This repair makes those ledger rows stock-neutral and
-- refreshes cached stock from the ledger.

BEGIN;

UPDATE inventory_ledger il
SET
    quantity = 0,
    new_stock = old_stock
WHERE il.type = 'RETURN'
  AND il.reference_type = 'return'
  AND EXISTS (
      SELECT 1
      FROM damaged_inventory di
      WHERE di.product_id = il.product_id
        AND di.return_id::text = il.reference_id::text
  );

UPDATE products
SET stock_cached = COALESCE((
    SELECT SUM(quantity)
    FROM inventory_ledger
    WHERE inventory_ledger.product_id = products.id
), 0);

COMMIT;
