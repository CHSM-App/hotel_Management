-- Customer tags (171). A table can hold several customers, each billed on their own. Every
-- food and bar order may carry a short customer tag ("Anil", "Customer 2"); open orders on
-- a table are grouped by it. Untagged orders stay one group, so nothing changes until a tag
-- is used. Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.food_orders', 'customer_tag') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD customer_tag NVARCHAR(60) NULL');
GO

IF COL_LENGTH('dbo.bar_orders', 'customer_tag') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD customer_tag NVARCHAR(60) NULL');
GO
