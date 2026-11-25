-- Restaurant / bar discounts (176). Given on the order (when posted to a room) or on
-- a standalone bar bill. On a room invoice, discount_amount stays the TOTAL taken
-- off; food_discount_amount and bar_discount_amount are the parts of it that belong
-- to the Restaurant and Bar sections, so the bill can print them under those.
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.food_orders', 'discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_food_orders_discount DEFAULT 0');
GO

IF COL_LENGTH('dbo.bar_orders', 'discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_bar_orders_discount DEFAULT 0');
GO

IF COL_LENGTH('dbo.bar_bills', 'discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.bar_bills ADD discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_bar_bills_discount DEFAULT 0');
GO

IF COL_LENGTH('dbo.invoices', 'food_discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD food_discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_food_discount DEFAULT 0');
GO

IF COL_LENGTH('dbo.invoices', 'bar_discount_amount') IS NULL
    EXEC('ALTER TABLE dbo.invoices ADD bar_discount_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_invoices_bar_discount DEFAULT 0');
GO
