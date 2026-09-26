-- food_orders_voided_invoice
--
-- Voiding a food bill put the order back in the unbilled queue by clearing
-- food_orders.invoice_id — correct for "foods to bill", but it also severed
-- the only link the bills list and bill detail use to find that order's
-- items and guest name. A voided food bill kept its VOID tag but showed up
-- empty: no items, no subtotal, no guest.
--
-- voided_invoice_id records which invoice a void released the order from,
-- purely for display. Nothing that decides "is this order billed" reads it —
-- invoice_id IS NULL keeps meaning exactly what it always meant.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.food_orders', 'voided_invoice_id') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD voided_invoice_id BIGINT NULL REFERENCES dbo.invoices(id)');

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_voided_invoice' AND object_id = OBJECT_ID('dbo.food_orders'))
    EXEC('CREATE INDEX ix_food_orders_voided_invoice ON dbo.food_orders(voided_invoice_id) WHERE voided_invoice_id IS NOT NULL');
