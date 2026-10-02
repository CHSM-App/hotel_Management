-- Other services (migration 112) is an add-on a property can have switched on,
-- same as has_events (046) and has_assets / has_expenses (087): off until
-- internal staff enable it, so a lodge doesn't get the section unasked.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodges', 'has_other_services') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_other_services BIT NOT NULL CONSTRAINT df_lodges_has_other_services DEFAULT 0');
GO
