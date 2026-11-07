-- The captain marks a fully delivered order "ready to bill" once the guest is
-- set to pay. Only then does it appear in Billing's "Food to bill" list.
IF COL_LENGTH('dbo.food_orders', 'ready_to_bill_at') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD ready_to_bill_at DATETIMEOFFSET NULL');
GO
