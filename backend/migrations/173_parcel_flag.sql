-- Parcel flag (173). A counter order may be marked as a parcel (packed to go) so it is
-- labelled "Parcel" instead of "Counter". Behaviour is otherwise identical.
-- Remember: the same change must also land in src/config/schema.sql.
IF COL_LENGTH('dbo.food_orders', 'is_parcel') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD is_parcel BIT NOT NULL CONSTRAINT df_food_orders_is_parcel DEFAULT 0');
GO

IF COL_LENGTH('dbo.bar_orders', 'is_parcel') IS NULL
    EXEC('ALTER TABLE dbo.bar_orders ADD is_parcel BIT NOT NULL CONSTRAINT df_bar_orders_is_parcel DEFAULT 0');
GO
