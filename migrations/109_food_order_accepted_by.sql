-- Who accepted an order into the kitchen queue: the first captain (or owner /
-- reception) to accept a guest QR order is the one taking care of it.
IF COL_LENGTH('dbo.food_orders', 'accepted_by') IS NULL
    EXEC('ALTER TABLE dbo.food_orders ADD accepted_by BIGINT NULL REFERENCES dbo.users(id)');
GO
