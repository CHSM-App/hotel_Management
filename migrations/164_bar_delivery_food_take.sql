-- Bar orders get a delivery step, can carry restaurant food, and captains get
-- their own bar.take permission (164). Remember: the same change must also land
-- in src/config/schema.sql.
--
-- Food on a bar order is a normal food_orders row (so the kitchen queue, the
-- ready/deliver flow and recipe stock all work) tagged with the bar order it
-- belongs to. Tagged rows are left out of every restaurant billing screen and
-- report; the bar bill and the bar report include them.

IF COL_LENGTH('dbo.bar_order_items', 'delivered_at') IS NULL
    EXEC('ALTER TABLE dbo.bar_order_items ADD delivered_at DATETIMEOFFSET NULL');

IF COL_LENGTH('dbo.bar_orders', 'food_subtotal') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD food_subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_bar_orders_food_subtotal DEFAULT 0');

IF COL_LENGTH('dbo.bar_bills', 'food_subtotal') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.bar_bills ADD food_subtotal DECIMAL(10,2) NOT NULL CONSTRAINT df_bar_bills_food_subtotal DEFAULT 0');
    EXEC('ALTER TABLE dbo.bar_bills ADD food_tax_percent DECIMAL(5,2) NOT NULL CONSTRAINT df_bar_bills_food_tax_pct DEFAULT 0');
    EXEC('ALTER TABLE dbo.bar_bills ADD food_tax_amount DECIMAL(10,2) NOT NULL CONSTRAINT df_bar_bills_food_tax_amt DEFAULT 0');
END

-- bar.take once, together with the column, so a role an owner later trims is not
-- overruled on a re-run. Gated by hasBar like every bar permission.
IF COL_LENGTH('dbo.food_orders', 'bar_order_id') IS NULL
BEGIN
    EXEC('ALTER TABLE dbo.food_orders ADD bar_order_id BIGINT NULL');
    UPDATE dbo.roles
    SET permissions = LEFT(permissions, LEN(permissions) - 1) + ',"bar.take"]'
    WHERE role_key IN ('OWNER', 'CAPTAIN') AND permissions LIKE '%]' AND permissions NOT LIKE '%"bar.take"%';
END

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'ix_food_orders_bar_order' AND object_id = OBJECT_ID('dbo.food_orders'))
    EXEC('CREATE INDEX ix_food_orders_bar_order ON dbo.food_orders(bar_order_id) WHERE bar_order_id IS NOT NULL');
