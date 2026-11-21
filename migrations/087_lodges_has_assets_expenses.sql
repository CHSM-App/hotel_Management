-- Asset inventory and expense tracking become add-ons, same shape as
-- has_events (046): a lodge doesn't get either tab until someone switches it
-- on. Default 0 leaves every existing lodge exactly as it is today — off,
-- until staff turns it on for that property.

IF COL_LENGTH('dbo.lodges', 'has_assets') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_assets BIT NOT NULL CONSTRAINT df_lodges_has_assets DEFAULT 0');
GO

IF COL_LENGTH('dbo.lodges', 'has_expenses') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_expenses BIT NOT NULL CONSTRAINT df_lodges_has_expenses DEFAULT 0');
GO
