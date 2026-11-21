-- A room QR order is billed by the restaurant first. It only rides on the
-- guest's stay bill once the desk chooses "Add to room bill", which sets this.
IF COL_LENGTH('dbo.food_orders', 'on_room_bill') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD on_room_bill BIT NOT NULL CONSTRAINT df_food_orders_on_room_bill DEFAULT 0');
GO
