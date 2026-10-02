-- Housekeeping (room cleaning, hotel linen, guest laundry) is an add-on a
-- property can have switched on, same as has_events (046), has_assets /
-- has_expenses (087) and has_other_services (113): off until internal staff
-- enable it, so no existing property sees a new section unasked.
--
-- Remember: the same change must also land in src/config/schema.sql.

IF COL_LENGTH('dbo.lodges', 'has_housekeeping') IS NULL
    EXEC('ALTER TABLE dbo.lodges ADD has_housekeeping BIT NOT NULL CONSTRAINT df_lodges_has_housekeeping DEFAULT 0');
GO
