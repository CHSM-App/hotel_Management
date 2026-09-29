-- A captain hands over a dish at a time: delivered_at on the line records that
-- this dish has gone to the guest, independent of the rest of the order.
IF COL_LENGTH('dbo.food_order_items', 'delivered_at') IS NULL
    EXEC('ALTER TABLE dbo.food_order_items ADD delivered_at DATETIMEOFFSET NULL');
GO
